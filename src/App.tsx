import { useCallback, useEffect, useState } from "react";
import { ClientEvent, createClient, HttpApiEvent, SyncState, type MatrixClient } from "matrix-js-sdk";
import { config } from "./config";
import { startClient, waitForKeyBackup } from "./lib/matrix";
import { clearSession, loadSession, saveSession, takeSsoServer, type Session } from "./lib/session";
import { connectToKuartalOS, type KuartalOS } from "./lib/kuartalos";
import { forgetCrmKey } from "./lib/crm";
import { Login } from "./components/Login";
import { Workspace } from "./components/Workspace";

type Phase =
  | { kind: "starting"; note: string }
  | { kind: "signed-out"; error?: string }
  | { kind: "ready"; client: MatrixClient };

export const DEVICE_NAME = "Konnect (web)";

export function App() {
  const [phase, setPhase] = useState<Phase>({ kind: "starting", note: "Opening Konnect" });
  const [os, setOs] = useState<KuartalOS | null>(null);

  useEffect(() => {
    void connectToKuartalOS().then((handle) => {
      setOs(handle);
      if (handle) {
        document.documentElement.dataset.theme = handle.theme;
        document.documentElement.dataset.embedded = "kuartalos";
        handle.setTitle(config.appName);
      }
    });
  }, []);

  const open = useCallback(async (session: Session) => {
    setPhase({ kind: "starting", note: "Loading your chats" });
    try {
      const client = await startClient(session);
      client.on(HttpApiEvent.SessionLoggedOut, () => {
        client.stopClient();
        clearSession();
        setPhase({ kind: "signed-out", error: "You were signed out on the server. Please sign in again." });
      });
      await waitForFirstSync(client);
      setPhase({ kind: "ready", client });
    } catch (e) {
      clearSession();
      setPhase({ kind: "signed-out", error: errorText(e) });
    }
  }, []);

  // On load: finish a Kuartal ID sign-in redirect, or resume the saved session.
  useEffect(() => {
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const token = params.get("loginToken");
      if (token) {
        window.history.replaceState(null, "", window.location.pathname);
        const homeserverUrl = takeSsoServer() ?? config.homeserverUrl;
        try {
          setPhase({ kind: "starting", note: "Signing you in" });
          const res = await createClient({ baseUrl: homeserverUrl }).loginRequest({
            type: "m.login.token",
            token,
            initial_device_display_name: DEVICE_NAME,
          });
          const session = { homeserverUrl, userId: res.user_id, deviceId: res.device_id, accessToken: res.access_token };
          saveSession(session);
          await open(session);
        } catch (e) {
          setPhase({ kind: "signed-out", error: errorText(e) });
        }
        return;
      }
      const saved = loadSession();
      if (saved) await open(saved);
      else setPhase({ kind: "signed-out" });
    })();
  }, [open]);

  /** Returns "pending" when recent message keys aren't backed up yet, so the UI can ask before losing them. */
  const signOut = useCallback(async (client: MatrixClient, force: boolean): Promise<"done" | "pending"> => {
    if (!force && (await waitForKeyBackup(client)) === "timeout") return "pending";
    const userId = client.getSafeUserId();
    try {
      await client.logout(true);
    } catch {
      /* already invalid on the server */
    }
    await client.clearStores().catch(() => undefined);
    await forgetCrmKey(userId);
    clearSession();
    setPhase({ kind: "signed-out" });
    return "done";
  }, []);

  if (phase.kind === "starting") {
    return (
      <div className="splash" role="status">
        <img src="/icon.svg" alt="" width={44} height={44} />
        <p className="muted">{phase.note}…</p>
      </div>
    );
  }
  if (phase.kind === "signed-out") {
    return (
      <Login
        error={phase.error}
        onSignedIn={(session) => {
          saveSession(session);
          void open(session);
        }}
      />
    );
  }
  return <Workspace client={phase.client} os={os} onSignOut={(force) => signOut(phase.client, force)} />;
}

function waitForFirstSync(client: MatrixClient): Promise<void> {
  if (client.isInitialSyncComplete()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onSync = (state: SyncState, _prev: SyncState | null, data?: { error?: Error }) => {
      if (state === SyncState.Prepared || state === SyncState.Syncing) {
        client.off(ClientEvent.Sync, onSync);
        resolve();
      } else if (state === SyncState.Error && data?.error && /M_UNKNOWN_TOKEN/.test(String((data.error as { errcode?: string }).errcode))) {
        client.off(ClientEvent.Sync, onSync);
        reject(data.error);
      }
    };
    client.on(ClientEvent.Sync, onSync);
  });
}

export function errorText(e: unknown): string {
  const err = e as { errcode?: string; data?: { error?: string }; message?: string };
  if (err?.errcode === "M_FORBIDDEN") return "That username or password isn't right.";
  if (err?.errcode === "M_UNKNOWN_TOKEN") return "Your session has ended. Please sign in again.";
  if (err?.errcode === "M_LIMIT_EXCEEDED") return "Too many attempts. Wait a minute and try again.";
  if (err?.data?.error) return err.data.error;
  if (err?.message && /fetch|network/i.test(err.message)) return "Can't reach the Konnect server. Check your connection.";
  return err?.message ?? "Something went wrong.";
}
