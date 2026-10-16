import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createClient } from "matrix-js-sdk";
import { config } from "../config";
import { loadSession, rememberSsoServer, SESSION_KEY, type Session } from "../lib/session";
import { DEVICE_NAME, errorText } from "../App";

interface Flows {
  password: boolean;
  sso: { id?: string; name: string }[];
}

export function Login({ error, onSignedIn }: { error?: string; onSignedIn: (s: Session) => void }) {
  const [server, setServer] = useState(config.homeserverUrl);
  const [editingServer, setEditingServer] = useState(false);
  const [flows, setFlows] = useState<Flows | null>(null);
  const [flowError, setFlowError] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(error ?? "");
  const embedded = window.parent !== window;

  const baseUrl = useMemo(() => normalizeServer(server), [server]);

  useEffect(() => {
    let cancelled = false;
    setFlows(null);
    setFlowError("");
    const t = window.setTimeout(async () => {
      try {
        const res = await createClient({ baseUrl }).loginFlows();
        if (cancelled) return;
        const sso: Flows["sso"] = [];
        let password = false;
        for (const f of res.flows) {
          if (f.type === "m.login.password") password = true;
          if (f.type === "m.login.sso") {
            const providers = (f as { identity_providers?: { id: string; name: string }[] }).identity_providers ?? [];
            if (providers.length) sso.push(...providers.map((p) => ({ id: p.id, name: p.name })));
            else sso.push({ name: config.ssoLabel });
          }
        }
        setFlows({ password, sso });
      } catch {
        if (!cancelled) setFlowError("Can't reach this server.");
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [baseUrl]);

  // When sign-in finishes in another tab (Kuartal ID opens in a tab when Konnect runs inside KuartalOS).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== SESSION_KEY) return;
      const s = loadSession();
      if (s) onSignedIn(s);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [onSignedIn]);

  function startSso(idpId?: string) {
    rememberSsoServer(baseUrl);
    const redirect = window.location.origin + window.location.pathname;
    const url = createClient({ baseUrl }).getSsoLoginUrl(redirect, "sso", idpId);
    if (embedded) window.open(url, "_blank", "noopener");
    else window.location.assign(url);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError("");
    try {
      const res = await createClient({ baseUrl }).loginRequest({
        type: "m.login.password",
        identifier: { type: "m.id.user", user: username.trim().replace(/^@/, "") },
        password,
        initial_device_display_name: DEVICE_NAME,
      });
      onSignedIn({ homeserverUrl: baseUrl, userId: res.user_id, deviceId: res.device_id, accessToken: res.access_token });
    } catch (err) {
      setFormError(errorText(err));
      setBusy(false);
    }
  }

  const kuartal = flows?.sso.find((p) => /kuartal/i.test(`${p.id} ${p.name}`)) ?? flows?.sso[0];
  const otherSso = flows?.sso.filter((p) => p !== kuartal) ?? [];

  return (
    <main className="login">
      <div className="login-card">
        <div className="brand">
          <img src="/icon.svg" alt="" width={40} height={40} />
          <div>
            <h1>Konnect</h1>
            <p className="muted">Encrypted chat, workspaces and your own CRM.</p>
          </div>
        </div>

        {formError && <p className="alert" role="alert">{formError}</p>}

        {!flows && !flowError && <p className="muted small">Connecting…</p>}
        {flowError && <p className="alert">{flowError}</p>}

        {kuartal && (
          <button className="btn primary wide" onClick={() => startSso(kuartal.id)}>
            {ssoLabel(kuartal.name)}
          </button>
        )}
        {otherSso.map((p) => (
          <button key={p.id ?? p.name} className="btn wide" onClick={() => startSso(p.id)}>
            Continue with {p.name}
          </button>
        ))}
        {embedded && kuartal && <p className="muted small">Sign-in opens in a new tab. Konnect continues here once you're done.</p>}

        {flows?.password && (
          <>
            {kuartal && <div className="divider"><span>or with a Konnect password</span></div>}
            <form onSubmit={submit} className="stack">
              <label>
                Username
                <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
              </label>
              <label>
                Password
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
              </label>
              <button className={`btn wide ${kuartal ? "" : "primary"}`} disabled={busy}>
                {busy ? "Signing in…" : "Sign in"}
              </button>
            </form>
          </>
        )}

        <div className="server-row">
          {editingServer ? (
            <label className="stack">
              Server
              <input value={server} onChange={(e) => setServer(e.target.value)} onBlur={() => setEditingServer(false)} autoFocus />
            </label>
          ) : (
            <p className="muted small">
              Server: {new URL(baseUrl).host}{" "}
              <button className="link" onClick={() => setEditingServer(true)}>Change</button>
            </p>
          )}
        </div>
      </div>
      <p className="muted small footer-note">Konnect chats are end-to-end encrypted. Kuartal can't read them.</p>
    </main>
  );
}

function ssoLabel(name: string): string {
  if (!/kuartal/i.test(name)) return config.ssoLabel;
  return /^sign in/i.test(name) ? name : `Sign in with ${name}`;
}

function normalizeServer(input: string): string {
  let v = input.trim().replace(/\/+$/, "");
  if (!v) return config.homeserverUrl;
  if (!/^https?:\/\//.test(v)) v = `https://${v}`;
  try {
    return new URL(v).origin;
  } catch {
    return config.homeserverUrl;
  }
}
