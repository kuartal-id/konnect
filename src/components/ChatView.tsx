import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Direction, EventStatus, EventType, KnownMembership, type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk";
import { Avatar, Icon } from "./Avatar";
import { acceptInvite, directPartner, roomNetwork, summarize } from "../lib/rooms";

interface Props {
  client: MatrixClient;
  room: Room;
  version: number;
  crmOpen: boolean;
  showBack: boolean;
  onBack: () => void;
  onToggleCrm: () => void;
  onInvite: () => void;
  onUnlock: () => void;
  onLeft: () => void;
}

export function ChatView({ client, room, version, crmOpen, showBack, onBack, onToggleCrm, onInvite, onUnlock, onLeft }: Props) {
  const me = client.getUserId();
  const summary = summarize(client, room);
  const network = roomNetwork(room);
  const isInvite = room.getMyMembership() === KnownMembership.Invite;
  const partner = summary.kind === "direct" ? directPartner(client, room) : null;
  const memberCount = room.getJoinedMemberCount();

  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [canLoadOlder, setCanLoadOlder] = useState(true);

  const all = room.getLiveTimeline().getEvents();
  const create = all.find((e) => e.getType() === EventType.RoomCreate);
  // Hide the creator's own "joined" line right after "started this chat".
  const events = all.filter(
    (e) => isShown(e) && !(create && e.getType() === EventType.RoomMember && e.getStateKey() === create.getSender() && e.getContent().membership === "join" && e.getTs() - create.getTs() < 5000),
  );
  const atStart = Boolean(create);
  const lastEvent = events[events.length - 1];

  // Keep the view pinned to the newest message unless the person scrolled up.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [version, room.roomId]);

  useEffect(() => {
    atBottom.current = true;
    setCanLoadOlder(true);
  }, [room.roomId]);

  // Mark as read when the newest message is on screen.
  useEffect(() => {
    if (!lastEvent || isInvite || !document.hasFocus()) return;
    if (lastEvent.status !== null && lastEvent.status !== EventStatus.SENT) return;
    if (lastEvent.getSender() === me) return;
    void client.sendReadReceipt(lastEvent).catch(() => undefined);
  }, [client, lastEvent, isInvite, me]);

  async function loadOlder() {
    setLoadingOlder(true);
    const el = scroller.current;
    const before = el?.scrollHeight ?? 0;
    try {
      await client.scrollback(room, 30);
      setCanLoadOlder(Boolean(room.getLiveTimeline().getPaginationToken(Direction.Backward)));
    } catch {
      setCanLoadOlder(false);
    }
    setLoadingOlder(false);
    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight - before;
    });
  }

  const typing = room
    .getMembers()
    .filter((m) => m.typing && m.userId !== me)
    .map((m) => m.name);

  return (
    <section className="chat" aria-label={summary.name}>
      <header className="chat-head">
        {showBack && (
          <button className="icon-btn" onClick={onBack} aria-label="Back to chats">
            <Icon name="back" />
          </button>
        )}
        <Avatar id={partner ?? room.roomId} name={summary.name} size={34} square={summary.kind === "group"} />
        <div className="chat-title">
          <h2>{summary.name}</h2>
          <p className="muted small">
            {network ? <span className={`net net-${network.id}`}>{network.name}</span> : null}
            {summary.encrypted ? (
              <span className="enc">
                <Icon name="lock" size={12} /> Encrypted
              </span>
            ) : network ? (
              <span>Bridged · not end-to-end encrypted in Konnect</span>
            ) : (
              <span>Not encrypted</span>
            )}
            {summary.kind === "group" && <span>{memberCount === 1 ? "1 member" : `${memberCount} members`}</span>}
            {partner && <span className="mono">{partner}</span>}
          </p>
        </div>
        <div className="head-actions">
          {summary.kind === "group" && !isInvite && (
            <button className="icon-btn" onClick={onInvite} aria-label="Invite people" title="Invite people">
              <Icon name="user-plus" />
            </button>
          )}
          <button className={`icon-btn ${crmOpen ? "on" : ""}`} onClick={onToggleCrm} aria-label="Contact details" title="Contact details" aria-pressed={crmOpen}>
            <Icon name="panel" />
          </button>
        </div>
      </header>

      {isInvite ? (
        <InviteCard client={client} room={room} onLeft={onLeft} />
      ) : (
        <>
          <div
            className="timeline"
            ref={scroller}
            onScroll={(e) => {
              const el = e.currentTarget;
              atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
            }}
          >
            {canLoadOlder && !atStart && (
              <button className="btn small ghost load-older" onClick={loadOlder} disabled={loadingOlder}>
                {loadingOlder ? "Loading…" : "Load earlier messages"}
              </button>
            )}
            {events.map((ev, i) => (
              <EventRow key={ev.getId() ?? ev.getTxnId() ?? i} ev={ev} prev={events[i - 1]} room={room} me={me} onUnlock={onUnlock} />
            ))}
          </div>
          <p className="typing muted small" aria-live="polite">
            {typing.length ? `${typing.slice(0, 2).join(" and ")} ${typing.length > 1 ? "are" : "is"} typing…` : ""}
          </p>
          <Composer client={client} room={room} />
        </>
      )}
    </section>
  );
}

function isShown(ev: MatrixEvent): boolean {
  const t = ev.getType();
  if (ev.isRedacted()) return t === EventType.RoomMessage;
  if (t === EventType.RoomMessage || t === EventType.RoomMessageEncrypted) return !ev.isRelation("m.replace");
  if (t === EventType.RoomMember) {
    const m = ev.getContent().membership;
    const prev = ev.getPrevContent().membership;
    return m !== prev && (m === "join" || m === "invite" || m === "leave");
  }
  return t === EventType.RoomName || t === EventType.RoomCreate;
}

function sameDay(a: number, b: number) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

function dayLabel(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(Date.now() - 864e5);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

function EventRow({ ev, prev, room, me, onUnlock }: { ev: MatrixEvent; prev?: MatrixEvent; room: Room; me: string | null; onUnlock: () => void }) {
  const ts = ev.getTs();
  const newDay = !prev || !sameDay(prev.getTs(), ts);
  const sender = ev.getSender() ?? "";
  const name = room.getMember(sender)?.name ?? sender;
  const t = ev.getType();

  const day = newDay ? (
    <div className="day">
      <span>{dayLabel(ts)}</span>
    </div>
  ) : null;

  if (t === EventType.RoomMember || t === EventType.RoomName || t === EventType.RoomCreate) {
    const c = ev.getContent();
    const target = c.displayname ?? ev.getStateKey() ?? "";
    let text = "";
    if (t === EventType.RoomCreate) text = `${name} started this chat`;
    else if (t === EventType.RoomName) text = `${name} renamed the chat to "${c.name}"`;
    else if (c.membership === "join") text = `${target} joined`;
    else if (c.membership === "invite") text = `${name} invited ${target}`;
    else if (c.membership === "leave") text = sender === ev.getStateKey() ? `${target} left` : `${name} removed ${target}`;
    return (
      <>
        {day}
        <p className="notice muted small">{text}</p>
      </>
    );
  }

  const mine = sender === me;
  const grouped = !newDay && prev?.getSender() === sender && (prev.getType() === EventType.RoomMessage || prev.getType() === EventType.RoomMessageEncrypted) && ts - prev.getTs() < 5 * 60e3;
  const content = ev.getContent() as { body?: string; msgtype?: string; formatted_body?: string };
  const pending = ev.status === EventStatus.SENDING || ev.status === EventStatus.QUEUED || ev.status === EventStatus.ENCRYPTING;
  const failed = ev.status === EventStatus.NOT_SENT;

  let body: JSX.Element;
  if (ev.isRedacted()) body = <em className="muted">Message deleted</em>;
  else if (ev.isDecryptionFailure()) {
    body = (
      <span className="locked">
        <Icon name="lock" size={13} /> This message is locked on this device.{" "}
        <button className="link" onClick={onUnlock}>Unlock with recovery key</button>
      </span>
    );
  } else if (ev.isBeingDecrypted() || ev.getType() === EventType.RoomMessageEncrypted) body = <em className="muted">Decrypting…</em>;
  else if (content.msgtype === "m.emote") body = <em>* {name} {content.body}</em>;
  else if (content.msgtype === "m.image" || content.msgtype === "m.file" || content.msgtype === "m.video" || content.msgtype === "m.audio") {
    body = <span className="muted">[{content.msgtype.slice(2)}] {content.body}. Attachments come in the next update.</span>;
  } else body = <Linkified text={content.body ?? ""} />;

  return (
    <>
      {day}
      <div className={`msg ${mine ? "mine" : ""} ${grouped ? "grouped" : ""} ${pending ? "pending" : ""}`}>
        {!grouped && (
          <div className="msg-meta">
            <span className="sender">{mine ? "You" : name}</span>
            <time className="muted small" dateTime={new Date(ts).toISOString()}>
              {new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
            </time>
          </div>
        )}
        <div className={`bubble ${content.msgtype === "m.notice" ? "notice-msg" : ""}`}>{body}</div>
        {failed && <p className="err small">Not sent. Check your connection; it will retry.</p>}
      </div>
    </>
  );
}

/** Plain text with web links made clickable. Never renders HTML from other people. */
function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<]+)/g);
  return (
    <span className="text">
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noopener noreferrer nofollow">
            {p}
          </a>
        ) : (
          p
        ),
      )}
    </span>
  );
}

function Composer({ client, room }: { client: MatrixClient; room: Room }) {
  const [text, setText] = useState("");
  const typingUntil = useRef(0);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setText("");
    input.current?.focus();
  }, [room.roomId]);

  function send() {
    const body = text.trim();
    if (!body) return;
    setText("");
    typingUntil.current = 0;
    void client.sendTyping(room.roomId, false, 0).catch(() => undefined);
    void client.sendTextMessage(room.roomId, body).catch(() => undefined);
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  }

  function onChange(v: string) {
    setText(v);
    const now = Date.now();
    if (v && now > typingUntil.current) {
      typingUntil.current = now + 3000;
      void client.sendTyping(room.roomId, true, 5000).catch(() => undefined);
    }
  }

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <textarea
        ref={input}
        rows={1}
        value={text}
        placeholder={`Message ${room.name}`}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKey}
        aria-label="Message"
      />
      <button className="icon-btn send" aria-label="Send" disabled={!text.trim()}>
        <Icon name="send" />
      </button>
    </form>
  );
}

function InviteCard({ client, room, onLeft }: { client: MatrixClient; room: Room; onLeft: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inviter = room.getDMInviter() ?? room.getMember(client.getUserId() ?? "")?.events.member?.getSender();
  const network = roomNetwork(room);
  return (
    <div className="empty">
      <h3>{room.name}</h3>
      <p className="muted">
        {inviter ? `${room.getMember(inviter)?.name ?? inviter} invited you` : "You're invited"}
        {network ? ` · ${network.name}` : ""}
      </p>
      {error && <p className="alert">{error}</p>}
      <div className="row">
        <button
          className="btn primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await acceptInvite(client, room);
            } catch (e) {
              setError((e as Error).message);
              setBusy(false);
            }
          }}
        >
          Accept
        </button>
        <button
          className="btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await client.leave(room.roomId).catch(() => undefined);
            onLeft();
          }}
        >
          Decline
        </button>
      </div>
    </div>
  );
}
