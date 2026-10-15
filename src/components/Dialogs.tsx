import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { MatrixClient, Room } from "matrix-js-sdk";
import { Avatar, Icon } from "./Avatar";
import { createGroup, createWorkspace, normalizeUserId, openDirectChat } from "../lib/rooms";
import { setUpRecovery, type SecurityState } from "../lib/matrix";
import { errorText } from "../App";

export function Modal({ title, onClose, children, wide = false }: { title: string; onClose?: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("input, textarea, button.primary")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <header className="modal-head">
          <h2>{title}</h2>
          {onClose && (
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              <Icon name="close" />
            </button>
          )}
        </header>
        {children}
      </div>
    </div>
  );
}

type NewKind = "person" | "group" | "workspace";

export function NewChatDialog({ client, workspaces, currentWorkspace, initial = "person", onDone, onClose }: {
  client: MatrixClient;
  workspaces: Room[];
  currentWorkspace: Room | null;
  initial?: NewKind;
  onDone: (roomId: string, kind: NewKind) => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<NewKind>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(fn: () => Promise<string>) {
    setBusy(true);
    setError("");
    try {
      onDone(await fn(), kind);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <Modal title="New" onClose={onClose}>
      <div className="tabs" role="tablist">
        {(["person", "group", "workspace"] as NewKind[]).map((k) => (
          <button key={k} role="tab" aria-selected={kind === k} className={`tab ${kind === k ? "on" : ""}`} onClick={() => setKind(k)}>
            {k === "person" ? "Direct message" : k === "group" ? "Group chat" : "Workspace"}
          </button>
        ))}
      </div>
      {error && <p className="alert">{error}</p>}
      {kind === "person" && <PersonPicker client={client} busy={busy} onPick={(id) => run(() => openDirectChat(client, id))} />}
      {kind === "group" && (
        <GroupForm client={client} workspaces={workspaces} currentWorkspace={currentWorkspace} busy={busy} onSubmit={(name, invite, ws) => run(() => createGroup(client, name, invite, ws))} />
      )}
      {kind === "workspace" && <WorkspaceForm busy={busy} onSubmit={(name) => run(() => createWorkspace(client, name))} />}
    </Modal>
  );
}

function PersonPicker({ client, busy, onPick }: { client: MatrixClient; busy: boolean; onPick: (userId: string) => void }) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<{ user_id: string; display_name?: string }[]>([]);
  const me = client.getUserId();

  useEffect(() => {
    const q = term.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const t = window.setTimeout(async () => {
      try {
        const res = await client.searchUserDirectory({ term: q, limit: 8 });
        setResults(res.results.filter((r) => r.user_id !== me));
      } catch {
        setResults([]);
      }
    }, 250);
    return () => window.clearTimeout(t);
  }, [client, term, me]);

  const typed = normalizeUserId(term, client.getDomain());
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (typed) onPick(typed);
      }}
    >
      <label>
        Name or Konnect ID
        <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="e.g. diemas or @diemas:kuartalsystems.com" />
      </label>
      <ul className="pick-list">
        {results.map((r) => (
          <li key={r.user_id}>
            <button type="button" className="contact-row" disabled={busy} onClick={() => onPick(r.user_id)}>
              <Avatar id={r.user_id} name={r.display_name ?? r.user_id} size={32} />
              <span className="contact-main">
                <span className="contact-name">{r.display_name ?? r.user_id}</span>
                <span className="muted small mono">{r.user_id}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button className="btn primary" disabled={!typed || busy}>
        {busy ? "Starting…" : typed ? `Message ${typed}` : "Message"}
      </button>
      <p className="muted small">New direct messages are end-to-end encrypted.</p>
    </form>
  );
}

function GroupForm({ client, workspaces, currentWorkspace, busy, onSubmit }: {
  client: MatrixClient;
  workspaces: Room[];
  currentWorkspace: Room | null;
  busy: boolean;
  onSubmit: (name: string, invite: string[], ws: Room | null) => void;
}) {
  const [name, setName] = useState("");
  const [people, setPeople] = useState("");
  const [ws, setWs] = useState(currentWorkspace?.roomId ?? "");
  const ids = people
    .split(/[\s,]+/)
    .map((p) => normalizeUserId(p, client.getDomain()))
    .filter((v): v is string => Boolean(v));
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onSubmit(name.trim(), ids, workspaces.find((w) => w.roomId === ws) ?? null);
      }}
    >
      <label>
        Group name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Argapura sales" required />
      </label>
      <label>
        Invite people
        <input value={people} onChange={(e) => setPeople(e.target.value)} placeholder="Konnect IDs, separated by commas" />
      </label>
      {workspaces.length > 0 && (
        <label>
          Workspace
          <select value={ws} onChange={(e) => setWs(e.target.value)}>
            <option value="">None</option>
            {workspaces.map((w) => (
              <option key={w.roomId} value={w.roomId}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <button className="btn primary" disabled={busy || !name.trim()}>
        {busy ? "Creating…" : "Create encrypted group"}
      </button>
    </form>
  );
}

function WorkspaceForm({ busy, onSubmit }: { busy: boolean; onSubmit: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onSubmit(name.trim());
      }}
    >
      <p className="muted small">A workspace holds a team's group chats, like a Slack workspace or a Discord server.</p>
      <label>
        Workspace name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Kuartal Team" required />
      </label>
      <button className="btn primary" disabled={busy || !name.trim()}>
        {busy ? "Creating…" : "Create workspace"}
      </button>
    </form>
  );
}

export function InviteDialog({ client, room, onClose }: { client: MatrixClient; room: Room; onClose: () => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const userId = normalizeUserId(value, client.getDomain());
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!userId) return;
    setBusy(true);
    try {
      await client.invite(room.roomId, userId);
      setMsg(`Invited ${userId}.`);
      setValue("");
    } catch (err) {
      setMsg(errorText(err));
    }
    setBusy(false);
  }
  return (
    <Modal title={`Invite to ${room.name}`} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label>
          Konnect ID
          <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="@name:kuartalsystems.com" />
        </label>
        {msg && <p className="muted small">{msg}</p>}
        <button className="btn primary" disabled={!userId || busy}>
          Invite
        </button>
      </form>
    </Modal>
  );
}

/** Asked by the encryption engine whenever it needs the recovery key. */
export function RecoveryPrompt({ hint, onSubmit, onCancel }: { hint: string; onSubmit: (key: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState("");
  return (
    <Modal title="Enter your recovery key" onClose={onCancel}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(value);
        }}
      >
        <p className="muted small">It unlocks your encrypted messages and your CRM on this device. You saved it when you set up Konnect.</p>
        {hint && <p className="alert small">{hint}</p>}
        <textarea rows={2} className="mono" value={value} onChange={(e) => setValue(e.target.value)} placeholder="EsT1 abcd efgh …" aria-label="Recovery key" autoComplete="off" spellCheck={false} />
        <div className="row">
          <button className="btn primary" disabled={!value.trim()}>
            Unlock
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            Not now
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function SetupRecoveryDialog({ client, onDone, onClose }: { client: MatrixClient; onDone: () => void; onClose: () => void }) {
  const [step, setStep] = useState<"intro" | "working" | "show">("intro");
  const [password, setPassword] = useState("");
  const [needPassword, setNeedPassword] = useState(false);
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function start() {
    setStep("working");
    setError("");
    try {
      setKey(await setUpRecovery(client, password || undefined));
      setStep("show");
    } catch (e) {
      const status = (e as { httpStatus?: number }).httpStatus;
      if (status === 401) {
        setNeedPassword(true);
        setError(password ? "That password isn't right." : "Confirm your Konnect password to continue.");
      } else setError(errorText(e));
      setStep("intro");
    }
  }

  return (
    <Modal title="Protect your messages" onClose={step === "show" ? undefined : onClose}>
      {step !== "show" ? (
        <div className="stack">
          <p>
            Konnect creates a <strong>recovery key</strong>. It's the only way to read your encrypted messages and your CRM on a new phone or computer.
          </p>
          <p className="muted small">Kuartal can't recover it for you. Save it somewhere safe, like a password manager.</p>
          {needPassword && (
            <label>
              Konnect password
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </label>
          )}
          {error && <p className="alert small">{error}</p>}
          <button className="btn primary" onClick={start} disabled={step === "working"}>
            {step === "working" ? "Creating…" : "Create recovery key"}
          </button>
        </div>
      ) : (
        <div className="stack">
          <p>Your recovery key:</p>
          <code className="recovery-key">{key}</code>
          <div className="row">
            <button
              className="btn"
              onClick={async () => {
                await navigator.clipboard?.writeText(key).catch(() => undefined);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              className="btn"
              onClick={() => {
                const blob = new Blob([`Konnect recovery key for ${client.getUserId()}\n\n${key}\n`], { type: "text/plain" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = "konnect-recovery-key.txt";
                a.click();
                URL.revokeObjectURL(a.href);
              }}
            >
              Download
            </button>
          </div>
          <label className="check">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I've saved my recovery key
          </label>
          <button className="btn primary" disabled={!saved} onClick={onDone}>
            Done
          </button>
        </div>
      )}
    </Modal>
  );
}

export function SettingsDialog({ client, security, onSecurity, onSignOut, onClose }: {
  client: MatrixClient;
  security: SecurityState | null;
  onSecurity: () => void;
  onSignOut: (force: boolean) => Promise<"done" | "pending">;
  onClose: () => void;
}) {
  const userId = client.getSafeUserId();
  const [name, setName] = useState(client.getUser(userId)?.displayName ?? "");
  const [savedName, setSavedName] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);
  const [outState, setOutState] = useState<"idle" | "saving" | "pending">("idle");

  async function signOut(force: boolean) {
    setOutState("saving");
    const res = await onSignOut(force);
    if (res === "pending") setOutState("pending");
  }

  return (
    <Modal title="Settings" onClose={onClose} wide>
      <div className="settings">
        <section>
          <h3>Profile</h3>
          <form
            className="row"
            onSubmit={async (e) => {
              e.preventDefault();
              await client.setDisplayName(name.trim()).catch(() => undefined);
              setSavedName(true);
            }}
          >
            <input value={name} onChange={(e) => { setName(e.target.value); setSavedName(false); }} aria-label="Display name" placeholder="Display name" />
            <button className="btn">{savedName ? "Saved" : "Save"}</button>
          </form>
          <p className="muted small mono">{userId}</p>
        </section>

        <section>
          <h3>Encryption</h3>
          {!security ? (
            <p className="muted small">Checking…</p>
          ) : !security.hasRecovery ? (
            <>
              <p className="small">No recovery key yet. If you lose this device, you lose your message history and CRM.</p>
              <button className="btn primary" onClick={onSecurity}>Set up recovery key</button>
            </>
          ) : !security.deviceTrusted ? (
            <>
              <p className="small">This device isn't verified yet. Enter your recovery key to read older messages here.</p>
              <button className="btn primary" onClick={onSecurity}>Verify this device</button>
            </>
          ) : (
            <p className="small ok-text">
              <Icon name="shield" size={14} /> This device is verified and backed up.
            </p>
          )}
          <p className="muted small mono">Device {client.getDeviceId()}</p>
        </section>

        <section>
          <h3>Connected apps</h3>
          <p className="muted small">
            WhatsApp Business and Instagram inboxes will appear here once the Konnect server has them switched on. Chats from those apps show up in your list with their name, and you can keep CRM notes on them like any other contact.
          </p>
        </section>

        <section>
          <h3>Sign out</h3>
          {confirmOut ? (
            <div className="stack">
              <p className="small">
                {security?.hasRecovery
                  ? "You'll need your recovery key to read your encrypted messages and CRM when you sign back in."
                  : "You have no recovery key. Signing out will make your encrypted messages and CRM unreadable on any new sign-in."}
              </p>
              {outState === "pending" && (
                <p className="alert small">
                  Your newest messages aren't backed up yet, so you couldn't read them after signing back in. Check your connection and try again in a moment.
                </p>
              )}
              <div className="row">
                <button className="btn danger" onClick={() => void signOut(outState === "pending")} disabled={outState === "saving"}>
                  {outState === "saving" ? "Backing up keys…" : outState === "pending" ? "Sign out anyway" : "Sign out"}
                </button>
                <button className="btn" onClick={() => { setConfirmOut(false); setOutState("idle"); }}>Cancel</button>
              </div>
            </div>
          ) : (
            <button className="btn" onClick={() => setConfirmOut(true)}>Sign out of Konnect</button>
          )}
        </section>
      </div>
    </Modal>
  );
}
