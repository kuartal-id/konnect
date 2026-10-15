/**
 * Creating the chat client, plus the encryption helpers Konnect needs:
 * a recovery key that unlocks message history and the encrypted CRM on any device.
 */
import { createClient, MatrixError, type MatrixClient } from "matrix-js-sdk";
import { decodeRecoveryKey } from "matrix-js-sdk/lib/crypto-api/recovery-key.js";
import type { SecretStorageKeyDescription } from "matrix-js-sdk/lib/secret-storage.js";
import type { Session } from "./session";

/** Asks the person for their recovery key. Resolves null if they cancel. */
export type RecoveryKeyPrompt = (hint: string) => Promise<string | null>;

let promptForKey: RecoveryKeyPrompt | null = null;
export function setRecoveryKeyPrompt(prompt: RecoveryKeyPrompt | null): void {
  promptForKey = prompt;
}

/** Unlocked secret-storage keys for this tab only. Never written to disk. */
const unlocked = new Map<string, Uint8Array<ArrayBuffer>>();

export async function startClient(session: Session): Promise<MatrixClient> {
  unlocked.clear();
  const client: MatrixClient = createClient({
    baseUrl: session.homeserverUrl,
    accessToken: session.accessToken,
    userId: session.userId,
    deviceId: session.deviceId,
    timelineSupport: true,
    cryptoCallbacks: {
      getSecretStorageKey: async ({ keys }) => {
        for (const id of Object.keys(keys)) {
          const key = unlocked.get(id);
          if (key) return [id, key];
        }
        const [keyId, info] = Object.entries(keys)[0] ?? [];
        if (!keyId || !info || !promptForKey) return null;
        const key = await askForKey(client, info);
        if (!key) return null;
        unlocked.set(keyId, key);
        return [keyId, key];
      },
      cacheSecretStorageKey: (keyId, _info, key) => {
        unlocked.set(keyId, key);
      },
    },
  });

  // Rust encryption engine (same core as Element X). Keys are kept in this browser's IndexedDB.
  await client.initRustCrypto({ useIndexedDB: true });
  await client.startClient({ initialSyncLimit: 30, lazyLoadMembers: true });
  return client;
}

async function askForKey(client: MatrixClient, info: SecretStorageKeyDescription): Promise<Uint8Array<ArrayBuffer> | null> {
  let hint = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const input = await promptForKey?.(hint);
    if (!input) return null;
    let key: Uint8Array<ArrayBuffer>;
    try {
      key = decodeRecoveryKey(input.trim());
    } catch {
      hint = "That doesn't look like a recovery key. It's 48 letters and numbers in groups of four.";
      continue;
    }
    if (await client.secretStorage.checkKey(key, info)) return key;
    hint = "That recovery key doesn't match this account.";
  }
  return null;
}

export interface SecurityState {
  /** Secret storage exists on the account (a recovery key was set up on some device). */
  hasRecovery: boolean;
  /** This device can read secret storage and is trusted by the account's cross-signing identity. */
  deviceTrusted: boolean;
  /** Secret storage is unlocked in this tab, so the encrypted CRM can be read and saved. */
  unlocked: boolean;
}

export async function getSecurityState(client: MatrixClient): Promise<SecurityState> {
  const crypto = client.getCrypto();
  const defaultKeyId = await client.secretStorage.getDefaultKeyId();
  const deviceTrusted = crypto
    ? Boolean((await crypto.getDeviceVerificationStatus(client.getSafeUserId(), client.getDeviceId() ?? ""))?.crossSigningVerified)
    : false;
  return {
    hasRecovery: Boolean(defaultKeyId),
    deviceTrusted,
    unlocked: Boolean(defaultKeyId && unlocked.has(defaultKeyId)),
  };
}

/**
 * First-time setup on an account: creates the cross-signing identity, secret storage and an
 * encrypted key backup. Returns the recovery key to show the person once.
 * `password` is only needed if the server asks to confirm identity (accounts with a password).
 */
export async function setUpRecovery(client: MatrixClient, password?: string): Promise<string> {
  const crypto = client.getCrypto();
  if (!crypto) throw new Error("Encryption is not available in this browser.");

  await crypto.bootstrapCrossSigning({
    authUploadDeviceSigningKeys: async (makeRequest) => {
      try {
        await makeRequest(null);
      } catch (e) {
        if (!(e instanceof MatrixError) || e.httpStatus !== 401 || !password) throw e;
        const session = (e.data as { session?: string }).session;
        await makeRequest({
          type: "m.login.password",
          identifier: { type: "m.id.user", user: client.getSafeUserId() },
          password,
          session,
        });
      }
    },
  });

  let recoveryKey = "";
  await crypto.bootstrapSecretStorage({
    setupNewSecretStorage: true,
    setupNewKeyBackup: !(await crypto.getKeyBackupInfo()),
    createSecretStorageKey: async () => {
      const generated = await crypto.createRecoveryKeyFromPassphrase();
      recoveryKey = generated.encodedPrivateKey ?? "";
      return generated;
    },
  });
  if (!recoveryKey) throw new Error("Could not create a recovery key.");
  return recoveryKey;
}

/**
 * On a new device: ask for the recovery key, trust this device, and restore older messages.
 * Asks for the key before touching cross-signing so a cancelled prompt can never create a new identity.
 */
export async function unlockWithRecoveryKey(client: MatrixClient): Promise<"unlocked" | "cancelled"> {
  const crypto = client.getCrypto();
  if (!crypto) throw new Error("Encryption is not available in this browser.");
  const found = await client.secretStorage.getKey();
  if (!found) throw new Error("This account has no recovery key yet.");
  const [keyId, info] = found;
  if (!unlocked.has(keyId)) {
    const key = await askForKey(client, info);
    if (!key) return "cancelled";
    unlocked.set(keyId, key);
  }

  const status = await crypto.getCrossSigningStatus();
  if (status.privateKeysInSecretStorage) {
    await crypto.bootstrapCrossSigning({});
  }
  try {
    await crypto.loadSessionBackupPrivateKeyFromSecretStorage();
    await crypto.checkKeyBackupAndEnable();
    // Restore in the background; it can take a while on big accounts.
    void crypto.restoreKeyBackup().catch(() => undefined);
  } catch {
    /* no key backup on this account yet */
  }
  return "unlocked";
}

/**
 * Waits until every message key on this device is in the encrypted key backup.
 *
 * The encryption engine uploads new keys to the backup after a random delay of up to 10 seconds.
 * If someone signs out inside that window, keys for their latest messages would be lost, and those
 * messages could never be read on another device. Sign-out calls this first.
 */
export async function waitForKeyBackup(client: MatrixClient, timeoutMs = 25000): Promise<"done" | "no-backup" | "timeout"> {
  const crypto = client.getCrypto();
  if (!crypto || !(await crypto.getActiveSessionBackupVersion())) return "no-backup";

  // Not part of the public API yet; read defensively so an SDK update can't break sign-out.
  const internals = crypto as unknown as {
    olmMachine?: { roomKeyCounts?: () => Promise<{ total: number; backedUp: number }> };
    backupManager?: { maybeUploadKey?: () => Promise<void> };
  };
  const pending = async (): Promise<number | null> => {
    try {
      const counts = await internals.olmMachine?.roomKeyCounts?.();
      return counts ? counts.total - counts.backedUp : null;
    } catch {
      return null;
    }
  };

  if ((await pending()) === 0) return "done";
  void internals.backupManager?.maybeUploadKey?.().catch(() => undefined);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    const left = await pending();
    if (left === 0) return "done";
    if (left === null) {
      // Can't count on this SDK version: give the upload loop its maximum start delay, then go.
      await new Promise((r) => setTimeout(r, 12000));
      return "done";
    }
  }
  return "timeout";
}
