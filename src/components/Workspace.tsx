import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClientEvent, EventType, RoomEvent, type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk";
import { Avatar, Icon } from "./Avatar";
import { ChatView } from "./ChatView";
import { CrmPanel } from "./CrmPanel";
import { ContactsView } from "./ContactsView";
import { InviteDialog, NewChatDialog, RecoveryPrompt, SettingsDialog, SetupRecoveryDialog } from "./Dialogs";
import { useClientVersion, useNarrow } from "../lib/hooks";
import { directPartner, listChats, openDirectChat, roomNetwork, workspaceChildren, type ChatSummary } from "../lib/rooms";
import { getSecurityState, setRecoveryKeyPrompt, unlockWithRecoveryKey, type SecurityState } from "../lib/matrix";
import { cachedCrmKey, loadCrm, saveCrm, unlockCrmKey, type Contact, type CrmData } from "../lib/crm";
import type { KuartalOS } from "../lib/kuartalos";
import { errorText } from "../App";

export type CrmState =
  | { status: "loading" }
  | { status: "locked" }
  | { status: "no-recovery" }
  | { status: "error"; error: string }
  | { status: "unlocked"; data: CrmData; saving: boolean };

type Section = "chats" | "contacts";
type Dialog = null | "new" | "new-workspace" | "invite" | "setup" | "settings";

export function Workspace({ client, os, onSignOut }: {
  client: MatrixClient;
  os: KuartalOS | null;
  onSignOut: (force: boolean) => Promise<"done" | "pending">;
}) {
  const version = useClientVersion(client);
  const narrow = useNarrow();
  const me = client.getSafeUserId();

  const [section, setSection] = useState<Section>("chats");
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [crmOpen, setCrmOpen] = useState(() => window.innerWidth >= 1100);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [filter, setFilter] = useState("");
  const [toast, setToast] = useState("");
  const [security, setSecurity] = useState<SecurityState | null>(null);
  const [crm, setCrm] = useState<CrmState>({ status: "loading" });
  const [prompt, setPrompt] = useState<{ hint: string; resolve: (v: string | null) => void } | null>(null);
  const crmKey = useRef<CryptoKey | null>(null);
  const roomIdRef = useRef(roomId);
  roomIdRef.current = roomId;

  // ---- Encryption and CRM ------------------------------------------------------------------

  useEffect(() => {
    setRecoveryKeyPrompt((hint) => new Promise((resolve) => setPrompt({ hint, resolve })));
    return () => setRecoveryKeyPrompt(null);
  }, []);

  const refreshSecurity = useCallback(async () => {
    const s = await getSecurityState(client).catch(() => null);
    setSecurity(s);
    return s;
  }, [client]);

  const openCrm = useCallback(
    async (key: CryptoKey) => {
      crmKey.current = key;
      try {
        setCrm({ status: "unlocked", data: await loadCrm(client, key), saving: false });
      } catch {
        setCrm({ status: "error", error: "Couldn't decrypt your CRM with this device's key. Unlock again with your recovery key." });
      }
    },
    [client],
  );

  useEffect(() => {
    void (async () => {
      const s = await refreshSecurity();
      const key = await cachedCrmKey(me);
      if (key) await openCrm(key);
      else setCrm({ status: s?.hasRecovery ? "locked" : "no-recovery" });
    })();
  }, [me, openCrm, refreshSecurity]);

  // Another device saved the CRM: reload it.
  useEffect(() => {
    const onAccountData = (ev: MatrixEvent) => {
      if (ev.getType() === "id.kuartal.konnect.crm.v1" && crmKey.current) void openCrm(crmKey.current);
    };
    client.on(ClientEvent.AccountData, onAccountData);
    return () => {
      client.off(ClientEvent.AccountData, onAccountData);
    };
  }, [client, openCrm]);

  const unlock = useCallback(async () => {
    const s = security ?? (await refreshSecurity());
    if (!s?.hasRecovery) {
      setDialog("setup");
      return;
    }
    try {
      if (!s.deviceTrusted) {
        const res = await unlockWithRecoveryKey(client);
        if (res === "cancelled") return;
      }
      const key = await unlockCrmKey(client);
      if (key) await openCrm(key);
      await refreshSecurity();
    } catch (e) {
      setCrm({ status: "error", error: errorText(e) });
    }
  }, [client, openCrm, refreshSecurity, security]);

  const afterSetup = useCallback(async () => {
    setDialog(null);
    try {
      const key = await unlockCrmKey(client);
      if (key) await openCrm(key);
    } catch (e) {
      setCrm({ status: "error", error: errorText(e) });
    }
    await refreshSecurity();
  }, [client, openCrm, refreshSecurity]);

  const saveContact = useCallback(
    (c: Contact) => {
      setCrm((prev) => {
        if (prev.status !== "unlocked" || !crmKey.current) return prev;
        const data: CrmData = { ...prev.data, contacts: { ...prev.data.contacts, [c.key]: c } };
        const key = crmKey.current;
        void saveCrm(client, key, data)
          .then(() => setCrm((p) => (p.status === "unlocked" ? { ...p, saving: false } : p)))
          .catch((e) => setToast(`CRM not saved: ${errorText(e)}`));
        return { status: "unlocked", data, saving: true };
      });
    },
    [client],
  );

  // ---- Notifications through KuartalOS ----------------------------------------------------

  useEffect(() => {
    const onTimeline = async (ev: MatrixEvent, room: Room | undefined, toStart: boolean | undefined, _removed: boolean, data: { liveEvent?: boolean }) => {
      if (toStart || !data?.liveEvent || !room || ev.getSender() === me) return;
      if (room.roomId === roomIdRef.current && document.hasFocus()) return;
      if (ev.isEncrypted()) await client.decryptEventIfNeeded(ev).catch(() => undefined);
      if (ev.getType() !== EventType.RoomMessage) return;
      const who = room.getMember(ev.getSender() ?? "")?.name ?? ev.getSender();
      const body = String(ev.getContent().body ?? "").slice(0, 120);
      os?.notify(room.name === who ? `${who}: ${body}` : `${who} in ${room.name}: ${body}`);
    };
    client.on(RoomEvent.Timeline, onTimeline);
    return () => {
      client.off(RoomEvent.Timeline, onTimeline);
    };
  }, [client, me, os]);

  // ---- Data for the lists --------------------------------------------------------------------

  // `version` changes whenever the client sees new data, so the lists are rebuilt then.
  const { chats, invites, workspaces } = useMemo(() => listChats(client), [client, version]);
  const workspace = workspaces.find((w) => w.roomId === workspaceId) ?? null;
  const inWorkspace = workspace ? workspaceChildren(workspace) : null;
  const q = filter.trim().toLowerCase();
  const visible = chats.filter((c) => (!inWorkspace || inWorkspace.has(c.room.roomId)) && (!q || c.name.toLowerCase().includes(q)));
  const unreadTotal = chats.reduce((n, c) => n + c.unread, 0) + invites.length;

  useEffect(() => {
    document.title = unreadTotal ? `(${unreadTotal}) Konnect` : "Konnect";
    os?.setTitle(unreadTotal ? `Konnect (${unreadTotal})` : "Konnect");
  }, [unreadTotal, os]);

  const room = roomId ? client.getRoom(roomId) : null;
  const summary = room ? [...chats, ...invites].find((c) => c.room === room) : undefined;
  const partner = room && summary?.kind === "direct" ? directPartner(client, room) : null;
  const contactKey = partner ?? room?.roomId ?? "";
  const contactName = (partner && room?.getMember(partner)?.name) || room?.name || "";

  function selectRoom(id: string) {
    setSection("chats");
    setRoomId(id);
  }

  async function openContact(c: Contact) {
    try {
      if (c.key.startsWith("!")) selectRoom(c.key);
      else selectRoom(await openDirectChat(client, c.key));
    } catch (e) {
      setToast(errorText(e));
    }
  }

  // ---- Layout ---------------------------------------------------------------------------------

  const showList = !narrow || (section === "chats" && !roomId);
  const showMain = !narrow || section === "contacts" || Boolean(roomId);
  const showCrm = crmOpen && section === "chats" && Boolean(room);

  const banner =
    security && !security.hasRecovery ? (
      <button className="banner" onClick={() => setDialog("setup")}>
        <Icon name="shield" size={16} />
        <span>
          <strong>Set up a recovery key</strong>
          <span className="muted small">So you never lose your messages or CRM</span>
        </span>
      </button>
    ) : security && !security.deviceTrusted ? (
      <button className="banner" onClick={() => void unlock()}>
        <Icon name="shield" size={16} />
        <span>
          <strong>Verify this device</strong>
          <span className="muted small">Enter your recovery key to read older messages</span>
        </span>
      </button>
    ) : null;

  return (
    <div className={`app ${narrow ? "narrow" : ""}`}>
      <nav className="rail" aria-label="Sections">
        <button className={`rail-btn ${section === "chats" && !workspaceId ? "on" : ""}`} onClick={() => { setSection("chats"); setWorkspaceId(null); }} title="All chats" aria-label="All chats">
          <Icon name="chat" size={20} />
        </button>
        <button className={`rail-btn ${section === "contacts" ? "on" : ""}`} onClick={() => { setSection("contacts"); setRoomId(null); }} title="Contacts" aria-label="Contacts">
          <Icon name="contacts" size={20} />
        </button>
        <span className="rail-sep" />
        {workspaces.map((w) => (
          <button key={w.roomId} className={`rail-ws ${workspaceId === w.roomId && section === "chats" ? "on" : ""}`} onClick={() => { setSection("chats"); setWorkspaceId(w.roomId); setRoomId(null); }} title={w.name} aria-label={`Workspace ${w.name}`}>
            <Avatar id={w.roomId} name={w.name} size={36} square />
          </button>
        ))}
        <button className="rail-btn" onClick={() => setDialog("new-workspace")} title="New workspace" aria-label="New workspace">
          <Icon name="plus" size={20} />
        </button>
        <span className="rail-fill" />
        <button className="rail-btn" onClick={() => setDialog("settings")} title="Settings" aria-label="Settings">
          <Icon name="settings" size={20} />
        </button>
        <button className="rail-me" onClick={() => setDialog("settings")} aria-label="Your profile">
          <Avatar id={me} name={client.getUser(me)?.displayName ?? me} size={32} />
        </button>
      </nav>

      {showList && section === "chats" && (
        <aside className="sidebar" aria-label="Chats">
          <header className="side-head">
            <h1>{workspace ? workspace.name : "Chats"}</h1>
            <button className="icon-btn" onClick={() => setDialog("new")} aria-label="New chat" title="New chat">
              <Icon name="plus" />
            </button>
          </header>
          {banner}
          <label className="search">
            <Icon name="search" size={16} />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search chats" aria-label="Search chats" />
          </label>
          <div className="chat-list">
            {invites.length > 0 && !workspace && (
              <>
                <p className="list-label">Invites</p>
                {invites.map((c) => (
                  <ChatRow key={c.room.roomId} chat={c} active={c.room.roomId === roomId} onClick={() => selectRoom(c.room.roomId)} invite />
                ))}
                <p className="list-label">Chats</p>
              </>
            )}
            {visible.map((c) => (
              <ChatRow key={c.room.roomId} chat={c} active={c.room.roomId === roomId} onClick={() => selectRoom(c.room.roomId)} />
            ))}
            {visible.length === 0 && (
              <div className="empty small-empty">
                <p className="muted">{q ? "No chats match." : workspace ? "No chats in this workspace yet." : "No chats yet."}</p>
                {!q && (
                  <button className="btn primary" onClick={() => setDialog("new")}>
                    {workspace ? "New group chat" : "Start a chat"}
                  </button>
                )}
              </div>
            )}
          </div>
        </aside>
      )}

      {showMain && (
        <main className="main">
          {section === "contacts" ? (
            <ContactsView crm={crm} onOpen={(c) => void openContact(c)} onUnlock={() => void unlock()} showBack={narrow} onBack={() => setSection("chats")} />
          ) : room ? (
            <ChatView
              client={client}
              room={room}
              version={version}
              crmOpen={showCrm}
              showBack={narrow}
              onBack={() => setRoomId(null)}
              onToggleCrm={() => setCrmOpen((v) => !v)}
              onInvite={() => setDialog("invite")}
              onUnlock={() => void unlock()}
              onLeft={() => setRoomId(null)}
            />
          ) : (
            <div className="empty welcome">
              <img src="/icon.svg" alt="" width={48} height={48} />
              <h2>Konnect</h2>
              <p className="muted">Pick a chat, or start a new one. Everything you write here is end-to-end encrypted.</p>
              <button className="btn primary" onClick={() => setDialog("new")}>Start a chat</button>
            </div>
          )}
        </main>
      )}

      {showCrm && room && (
        <div className={narrow ? "crm-overlay" : "crm-col"}>
          <CrmPanel
            crm={crm}
            isGroup={summary?.kind === "group"}
            contactKey={contactKey}
            defaultName={contactName}
            network={roomNetwork(room)?.name}
            onSave={saveContact}
            onUnlock={() => void unlock()}
            onClose={() => setCrmOpen(false)}
          />
        </div>
      )}

      {(dialog === "new" || dialog === "new-workspace") && (
        <NewChatDialog
          client={client}
          workspaces={workspaces}
          currentWorkspace={workspace}
          initial={dialog === "new-workspace" ? "workspace" : workspace ? "group" : "person"}
          onClose={() => setDialog(null)}
          onDone={(id, kind) => {
            setDialog(null);
            if (kind === "workspace") {
              setWorkspaceId(id);
              setRoomId(null);
              setSection("chats");
            } else selectRoom(id);
          }}
        />
      )}
      {dialog === "invite" && room && <InviteDialog client={client} room={room} onClose={() => setDialog(null)} />}
      {dialog === "setup" && <SetupRecoveryDialog client={client} onClose={() => setDialog(null)} onDone={() => void afterSetup()} />}
      {dialog === "settings" && (
        <SettingsDialog client={client} security={security} onClose={() => setDialog(null)} onSignOut={onSignOut} onSecurity={() => { setDialog(null); void unlock(); }} />
      )}
      {prompt && (
        <RecoveryPrompt
          hint={prompt.hint}
          onSubmit={(v) => { prompt.resolve(v); setPrompt(null); }}
          onCancel={() => { prompt.resolve(null); setPrompt(null); }}
        />
      )}
      {toast && (
        <div className="toast" role="status" onClick={() => setToast("")}>
          {toast}
        </div>
      )}
    </div>
  );
}

function ChatRow({ chat, active, onClick, invite = false }: { chat: ChatSummary; active: boolean; onClick: () => void; invite?: boolean }) {
  const time = chat.ts ? formatTime(chat.ts) : "";
  return (
    <button className={`chat-row ${active ? "on" : ""} ${chat.unread ? "unread" : ""}`} onClick={onClick}>
      <Avatar id={chat.room.roomId} name={chat.name} size={40} square={chat.kind === "group"} />
      <span className="chat-row-main">
        <span className="chat-row-top">
          <span className="chat-row-name ellipsis">{chat.name}</span>
          <span className="muted small">{time}</span>
        </span>
        <span className="chat-row-bottom">
          {chat.network && <span className={`net net-${chat.network.id}`}>{chat.network.name}</span>}
          <span className="muted small ellipsis">{invite ? "Invitation" : chat.preview}</span>
          {chat.unread > 0 && <span className="badge">{chat.unread > 99 ? "99+" : chat.unread}</span>}
        </span>
      </span>
    </button>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (now.getTime() - ts < 6 * 864e5) return d.toLocaleDateString(undefined, { weekday: "short" });
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

