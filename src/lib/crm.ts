/**
 * Personal CRM: each person's own contact notes, tags, deal stage and follow-up dates.
 *
 * Privacy model
 * - The CRM is one JSON document, encrypted in the browser with AES-256-GCM and stored on the chat
 *   server as the person's account data. The server (and Kuartal) only ever sees ciphertext.
 * - The AES key is random. It is kept in the person's secret storage, which is locked by their
 *   recovery key, so it follows them to any device they unlock.
 * - Each device keeps a non-extractable copy of the AES key in IndexedDB, so the recovery key is
 *   needed once per device, not on every visit. Signing out deletes it.
 */
import type { MatrixClient } from "matrix-js-sdk";
import type { SecretInfo } from "matrix-js-sdk/lib/secret-storage.js";

const KEY_SECRET = "id.kuartal.konnect.crm_key.v1";
const DATA_TYPE = "id.kuartal.konnect.crm.v1";

interface EncryptedDoc {
  v: 1;
  iv: string;
  data: string;
}

declare module "matrix-js-sdk/lib/@types/event" {
  interface SecretStorageAccountDataEvents {
    "id.kuartal.konnect.crm_key.v1": SecretInfo;
  }
  interface AccountDataEvents {
    "id.kuartal.konnect.crm.v1": EncryptedDoc;
  }
}

export const STAGES = ["Lead", "Talking", "Proposal", "Customer", "Closed"] as const;
export type Stage = (typeof STAGES)[number];

export interface Contact {
  /** Matrix user ID for 1:1 chats (including bridged WhatsApp/Instagram people), room ID for groups. */
  key: string;
  name: string;
  network?: string;
  company?: string;
  stage: Stage;
  tags: string[];
  note: string;
  /** YYYY-MM-DD */
  followUp?: string;
  updatedAt: number;
}

export interface CrmData {
  version: 1;
  contacts: Record<string, Contact>;
}

export const emptyCrm = (): CrmData => ({ version: 1, contacts: {} });

export function newContact(key: string, name: string, network?: string): Contact {
  return { key, name, network, stage: "Lead", tags: [], note: "", updatedAt: Date.now() };
}

export function isDue(c: Contact, today = new Date()): boolean {
  if (!c.followUp || c.stage === "Closed") return false;
  return c.followUp <= today.toISOString().slice(0, 10);
}

// ---- Key handling -------------------------------------------------------------------------

const b64 = {
  encode: (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)),
  decode: (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
};

function importKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Returns this device's CRM key without asking the person for anything, or null. */
export async function cachedCrmKey(userId: string): Promise<CryptoKey | null> {
  return idbGet(userId);
}

/**
 * Gets the CRM key, asking for the recovery key if needed (through the secret-storage prompt).
 * Creates the key the first time. Throws if the account has no recovery key set up yet.
 */
export async function unlockCrmKey(client: MatrixClient): Promise<CryptoKey | null> {
  const userId = client.getSafeUserId();
  const cached = await idbGet(userId);
  if (cached) return cached;

  if (!(await client.secretStorage.getDefaultKeyId())) {
    throw new Error("Set up your recovery key first. It protects your messages and your CRM.");
  }
  let raw: Uint8Array<ArrayBuffer>;
  if (await client.secretStorage.isStored(KEY_SECRET)) {
    const secret = await client.secretStorage.get(KEY_SECRET);
    if (!secret) return null;
    raw = b64.decode(secret) as Uint8Array<ArrayBuffer>;
  } else {
    raw = crypto.getRandomValues(new Uint8Array(32));
    await client.secretStorage.store(KEY_SECRET, b64.encode(raw));
  }
  const key = await importKey(raw);
  raw.fill(0);
  await idbPut(userId, key);
  return key;
}

export async function forgetCrmKey(userId: string): Promise<void> {
  await idbDelete(userId);
}

// ---- Reading and writing ------------------------------------------------------------------

export async function loadCrm(client: MatrixClient, key: CryptoKey): Promise<CrmData> {
  let doc = client.getAccountData(DATA_TYPE)?.getContent() as EncryptedDoc | undefined;
  if (!doc?.data) {
    try {
      doc = (await client.getAccountDataFromServer(DATA_TYPE)) ?? undefined;
    } catch {
      doc = undefined;
    }
  }
  if (!doc?.data || !doc.iv) return emptyCrm();
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64.decode(doc.iv) as Uint8Array<ArrayBuffer> },
    key,
    b64.decode(doc.data) as Uint8Array<ArrayBuffer>,
  );
  const data = JSON.parse(new TextDecoder().decode(plain)) as CrmData;
  return data?.version === 1 && data.contacts ? data : emptyCrm();
}

export async function saveCrm(client: MatrixClient, key: CryptoKey, data: CrmData): Promise<void> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(data)));
  await client.setAccountData(DATA_TYPE, { v: 1, iv: b64.encode(iv), data: b64.encode(new Uint8Array(cipher)) });
}

// ---- Tiny IndexedDB wrapper (CryptoKey objects can be stored as-is, non-extractable) -------

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("konnect-crm", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("keys");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbOp<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const conn = await db();
  return new Promise<T>((resolve, reject) => {
    const req = fn(conn.transaction("keys", mode).objectStore("keys"));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  }).finally(() => conn.close());
}

async function idbGet(id: string): Promise<CryptoKey | null> {
  try {
    return (await idbOp<CryptoKey | undefined>("readonly", (s) => s.get(id))) ?? null;
  } catch {
    return null;
  }
}
const idbPut = (id: string, key: CryptoKey) => idbOp<void>("readwrite", (s) => s.put(key, id)).catch(() => undefined);
const idbDelete = (id: string) => idbOp<void>("readwrite", (s) => s.delete(id)).catch(() => undefined);
