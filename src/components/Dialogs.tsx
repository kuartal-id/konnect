import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { MatrixClient, Room } from "matrix-js-sdk";
import { Avatar, Icon } from "./Avatar";
import { createGroup, createWorkspace, normalizeUserId, openDirectChat } from "../lib/rooms";
import { discovery, looksLikePhone, shortHandle, type DiscoverySettings } from "../lib/discovery";
import { setUpRecovery, type SecurityState } from "../lib/matrix";
import { getNotifyPref, notificationsSupported, setNotifyPref, type NotifyPref } from "../lib/notify";
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

interface Person {
  user_id: string;
  display_name?: string | null;
  via?: "search" | "handle" | "phone";
}

function PersonPicker({ client, busy, onPick }: { client: MatrixClient; busy: boolean; onPick: (userId: string) => void }) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<Person[]>([]);
  const [exact, setExact] = useState<Person | "none" | null>(null);
  const [phoneState, setPhoneState] = useState<"idle" | "looking" | Person | { error: string }>("idle");
  const me = client.getUserId();
  const domain = client.getDomain();
  const isPhone = looksLikePhone(term);
  const typed = isPhone ? null : normalizeUserId(term, domain);

  // Search by name or @handle (people who switched search off are left out by the server).
  useEffect(() => {
    const q = term.trim().replace(/^@/, "");
    setPhoneState("idle");
    if (q.length < 2 || isPhone) {
      setResults([]);
      return;
    }
    const t = window.setTimeout(async () => {
      try {
        const res = await client.searchUserDirectory({ term: q, limit: 8 });
        setResults(res.results.filter((r) => r.user_id !== me).map((r) => ({ ...r, via: "search" as const })));
      } catch {
        setResults([]);
      }
    }, 250);
    return () => window.clearTimeout(t);
  }, [client, term, me, isPhone]);

  // An exact @handle always works, even for people hidden from search.
  useEffect(() => {
    setExact(null);
    if (!typed || typed === me || !term.trim().startsWith("@")) return;
    const t = window.setTimeout(async () => {
      try {
        const profile = await client.getProfileInfo(typed);
        setExact({ user_id: typed, display_name: profile.displayname ?? null, via: "handle" });
      } catch {
        setExact("none");
      }
    }, 350);
    return () => window.clearTimeout(t);
  }, [client, typed, term, me]);

  async function findByPhone() {
    setPhoneState("looking");
    try {
      const found = await discovery.lookupPhone(client, term);
      setPhoneState({ ...found, via: "phone" });
    } catch (e) {
      setPhoneState({ error: (e as Error).message });
    }
  }

  const list: Person[] = [];
  if (exact && exact !== "none") list.push(exact);
  for (const r of results) if (!list.some((p) => p.user_id === r.user_id)) list.push(r);
  if (typeof phoneState === "object" && "user_id" in phoneState) list.push(phoneState);

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (isPhone) void findByPhone();
        else if (list[0]) onPick(list[0].user_id);
        else if (typed) onPick(typed);
      }}
    >
      <label>
        Handle, name or phone number
        <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="@handle, a name, or +62 812…" autoComplete="off" />
      </label>

      {isPhone && phoneState === "idle" && (
        <button type="submit" className="btn">
          Find who has this number
        </button>
      )}
      {phoneState === "looking" && <p className="muted small">Looking…</p>}
      {typeof phoneState === "object" && "error" in phoneState && <p className="muted small">{phoneState.error}</p>}
      {exact === "none" && !results.length && <p className="muted small">No one has the handle {shortHandle(typed ?? "", domain)}.</p>}

      <ul className="pick-list">
        {list.map((r) => (
          <li key={r.user_id}>
            <button type="button" className="contact-row" disabled={busy} onClick={() => onPick(r.user_id)}>
              <Avatar id={r.user_id} name={r.display_name || r.user_id} size={32} />
              <span className="contact-main">
                <span className="contact-name">{r.display_name || shortHandle(r.user_id, domain)}</span>
                <span className="muted small">
                  {shortHandle(r.user_id, domain)}
                  {r.via === "phone" ? " · found by phone number" : ""}
                </span>
              </span>
              <span className="muted small">{busy ? "Starting…" : "Message"}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="muted small">New direct messages are end-to-end encrypted. People choose in their settings whether they can be found in search or by phone number.</p>
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
        <input value={people} onChange={(e) => setPeople(e.target.value)} placeholder="@handles, separated by commas" />
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
      setMsg(`Invited ${shortHandle(userId, client.getDomain())}.`);
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
          Handle
          <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="@handle" />
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

/** "How people find you": search visibility and a verified phone number. */
export function FindMeSettings({ client }: { client: MatrixClient }) {
  const [settings, setSettings] = useState<DiscoverySettings | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [findable, setFindable] = useState(true);
  const handle = shortHandle(client.getSafeUserId(), client.getDomain());

  useEffect(() => {
    discovery.settings(client).then(setSettings, (e: Error) => setError(e.message));
  }, [client]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  const reload = async () => setSettings(await discovery.settings(client));

  return (
    <section aria-labelledby="find-me">
      <h3 id="find-me">How people find you</h3>
      {!settings ? (
        <p className="muted small">{error || "Loading…"}</p>
      ) : (
        <>
          <label className="switch-row">
            <span>
              <strong>Show me in search</strong>
              <span className="muted small">
                {settings.handle_search
                  ? `Anyone on Konnect can find you by your name or ${handle}.`
                  : `You're hidden from search. Only people who type your exact handle, ${handle}, can message you.`}
              </span>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={settings.handle_search}
              disabled={busy}
              onChange={(e) => {
                const on = e.target.checked;
                void run(async () => {
                  await discovery.update(client, { handle_search: on });
                  await reload();
                });
              }}
            />
          </label>

          <div className="phone-box">
            <strong>Phone number</strong>
            {settings.phone ? (
              <>
                <p className="small">
                  {settings.phone.masked} <span className="ok-text inline">· verified</span>
                </p>
                <label className="switch-row">
                  <span>
                    <span>Let people who have my number find me</span>
                    <span className="muted small">They have to know your number already. Konnect never shows it to anyone.</span>
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={settings.phone.lookup}
                    disabled={busy}
                    onChange={(e) => {
                      const on = e.target.checked;
                      void run(async () => {
                        await discovery.update(client, { phone_lookup: on });
                        await reload();
                      });
                    }}
                  />
                </label>
                <button
                  className="btn small"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await discovery.removePhone(client);
                      await reload();
                    })
                  }
                >
                  Remove number
                </button>
              </>
            ) : !settings.phone_verification ? (
              <p className="muted small">
                Finding people by phone number needs WhatsApp verification codes, which aren't switched on for this server yet.
              </p>
            ) : sent ? (
              <form
                className="stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    await discovery.confirmPhone(client, code, findable);
                    setSent(null);
                    setCode("");
                    setPhone("");
                    await reload();
                  });
                }}
              >
                <p className="small">We sent a 6-digit code to {sent} on WhatsApp.</p>
                <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code" aria-label="Verification code" />
                <label className="check">
                  <input type="checkbox" checked={findable} onChange={(e) => setFindable(e.target.checked)} /> Let people who have my number find me
                </label>
                <div className="row">
                  <button className="btn primary" disabled={busy || code.length !== 6}>Verify</button>
                  <button type="button" className="btn" onClick={() => setSent(null)}>Use a different number</button>
                </div>
              </form>
            ) : (
              <form
                className="row wrap"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    const res = await discovery.startPhone(client, phone);
                    setSent(res.masked);
                  });
                }}
              >
                <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="+62 812 3456 7890" aria-label="Phone number" className="grow" />
                <button className="btn" disabled={busy || !looksLikePhone(phone)}>Send code</button>
              </form>
            )}
            <p className="muted small">Konnect keeps only a scrambled fingerprint of your number, so it can't be read back or listed.</p>
          </div>
          {error && <p className="alert small">{error}</p>}
        </>
      )}
    </section>
  );
}

function NotificationSettings() {
  const [pref, setPref] = useState<NotifyPref>(getNotifyPref());
  const [denied, setDenied] = useState(false);
  if (!notificationsSupported()) return null;
  return (
    <section>
      <h3>Notifications on this device</h3>
      <div className="tabs" role="radiogroup" aria-label="Notifications">
        {(
          [
            ["off", "Off"],
            ["full", "Show messages"],
            ["private", "Hide message text"],
          ] as [NotifyPref, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            role="radio"
            aria-checked={pref === value}
            className={`tab ${pref === value ? "on" : ""}`}
            onClick={async () => {
              const result = await setNotifyPref(value);
              setPref(result);
              setDenied(value !== "off" && result === "off");
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="muted small">
        {denied
          ? "Your browser blocked notifications for Konnect. Allow them in the browser's site settings, then try again."
          : "Works while Konnect is open, including in a background tab or as an installed app."}
      </p>
    </section>
  );
}

function DevicesSection({ client }: { client: MatrixClient }) {
  const [devices, setDevices] = useState<{ id: string; name: string; lastSeen?: number; verified: boolean }[] | null>(null);
  const me = client.getSafeUserId();
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const { devices: list } = await client.getDevices();
        const crypto = client.getCrypto();
        const rows = await Promise.all(
          list.map(async (d) => ({
            id: d.device_id,
            name: d.display_name || d.device_id,
            lastSeen: d.last_seen_ts,
            verified: Boolean((await crypto?.getDeviceVerificationStatus(me, d.device_id))?.crossSigningVerified),
          })),
        );
        rows.sort((a, b) => Number(b.id === client.getDeviceId()) - Number(a.id === client.getDeviceId()) || (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
        if (live) setDevices(rows);
      } catch {
        if (live) setDevices([]);
      }
    })();
    return () => {
      live = false;
    };
  }, [client, me]);

  return (
    <section>
      <h3>Your devices</h3>
      {!devices ? (
        <p className="muted small">Loading…</p>
      ) : (
        <ul className="member-list">
          {devices.map((d) => (
            <li key={d.id} className="member-row">
              <span className="contact-main">
                <span className="contact-name">
                  {d.name}
                  {d.id === client.getDeviceId() && <span className="muted small"> · this device</span>}
                </span>
                <span className="muted small">
                  {d.lastSeen ? `Last active ${new Date(d.lastSeen).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}` : d.id}
                </span>
              </span>
              {d.verified ? (
                <span className="verified" title="Verified">
                  <Icon name="shield" size={14} />
                </span>
              ) : (
                <span className="warn-text small">Not verified</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">Don't recognise a device? Sign out of Kuartal ID everywhere and change your password, then verify your devices again.</p>
    </section>
  );
}

function BlockedSection({ client }: { client: MatrixClient }) {
  const [blocked, setBlocked] = useState(client.getIgnoredUsers());
  if (!blocked.length) return null;
  return (
    <section>
      <h3>Blocked people</h3>
      <ul className="member-list">
        {blocked.map((id) => (
          <li key={id} className="member-row">
            <span className="contact-main">
              <span className="contact-name">{shortHandle(id, client.getDomain())}</span>
            </span>
            <button
              className="btn small"
              onClick={async () => {
                const next = client.getIgnoredUsers().filter((u) => u !== id);
                await client.setIgnoredUsers(next).catch(() => undefined);
                setBlocked(next);
              }}
            >
              Unblock
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SettingsDialog({ client, security, embedded, onSecurity, onVerifyDevice, onSignOut, onClose }: {
  client: MatrixClient;
  security: SecurityState | null;
  embedded: boolean;
  onSecurity: () => void;
  onVerifyDevice: () => void;
  onSignOut: (force: boolean) => Promise<"done" | "pending">;
  onClose: () => void;
}) {
  const userId = client.getSafeUserId();
  const cached = client.getUser(userId)?.displayName;
  const [name, setName] = useState(cached && cached !== userId ? cached : "");

  useEffect(() => {
    client.getProfileInfo(userId).then(
      (p) => setName((current) => current || p.displayname || ""),
      () => undefined,
    );
  }, [client, userId]);
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
            className="row end"
            onSubmit={async (e) => {
              e.preventDefault();
              await client.setDisplayName(name.trim()).catch(() => undefined);
              setSavedName(true);
            }}
          >
            <label className="grow">
              Display name
              <input value={name} onChange={(e) => { setName(e.target.value); setSavedName(false); }} placeholder="Your name" />
            </label>
            <button className="btn">{savedName ? "Saved" : "Save"}</button>
          </form>
          <p className="muted small">Your handle: <strong>{shortHandle(userId, client.getDomain())}</strong></p>
        </section>

        <FindMeSettings client={client} />

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
              <p className="small">This device isn't verified yet. Verify it to read older messages here.</p>
              <div className="row wrap">
                <button className="btn primary" onClick={onSecurity}>Use recovery key</button>
                <button className="btn" onClick={onVerifyDevice}>Verify with another device</button>
              </div>
            </>
          ) : (
            <p className="small ok-text">
              <Icon name="shield" size={14} /> This device is verified and backed up.
            </p>
          )}
          <p className="muted small mono">Device {client.getDeviceId()}</p>
        </section>

        <DevicesSection client={client} />

        {!embedded && <NotificationSettings />}

        <BlockedSection client={client} />

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
