/**
 * The signed-in session lives in this browser only. The access token is what lets this device
 * talk to the chat server; signing out deletes it on the server and here.
 * Message keys are kept separately by the encryption engine in IndexedDB.
 */
export interface Session {
  homeserverUrl: string;
  userId: string;
  deviceId: string;
  accessToken: string;
}

export const SESSION_KEY = "konnect.session.v1";
const KEY = SESSION_KEY;
const PENDING_SSO = "konnect.sso.homeserver";

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<Session>;
    if (s.homeserverUrl && s.userId && s.deviceId && s.accessToken) return s as Session;
  } catch {
    /* storage blocked or corrupt: treat as signed out */
  }
  return null;
}

export function saveSession(s: Session): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function clearSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Remember which server an SSO redirect was started against, so the callback can finish it. */
export function rememberSsoServer(url: string): void {
  localStorage.setItem(PENDING_SSO, url);
}

export function takeSsoServer(): string | null {
  const url = localStorage.getItem(PENDING_SSO);
  localStorage.removeItem(PENDING_SSO);
  return url;
}
