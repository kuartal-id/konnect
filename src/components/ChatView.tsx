import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { Direction, EventStatus, EventType, KnownMembership, MsgType, type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk";
import { Avatar, Icon } from "./Avatar";
import { acceptInvite, directPartner, roomNetwork, summarize } from "../lib/rooms";
import { shortHandle } from "../lib/discovery";
import { formatBytes, isFileEvent, MAX_FILE_BYTES, sendFile, useFile } from "../lib/attachments";
import { deleteMessage, isEdited, messageText, QUICK_REACTIONS, reactionsFor, replyTargetId, sendText, snippet, toggleReaction } from "../lib/messages";
import { acceptNewIdentity, useTrust } from "../lib/trust";

interface Props {
  client: MatrixClient;
  room: Room;
  version: number;
  crmOpen: boolean;
  showBack: boolean;
  onBack: () => void;
  onToggleCrm: () => void;
  onInfo: () => void;
  onVerify: (userId: string) => void;
  onUnlock: () => void;
  onLeft: () => void;
}

export function ChatView({ client, room, version, crmOpen, showBack, onBack, onToggleCrm, onInfo, onVerify, onUnlock, onLeft }: Props) {
  const me = client.getUserId();
  const summary = summarize(client, room);
  const network = roomNetwork(room);
  const isInvite = room.getMyMembership() === KnownMembership.Invite;
  const partner = summary.kind === "direct" ? directPartner(client, room) : null;
  const trust = useTrust(client, partner);
  const memberCount = room.getJoinedMemberCount();

  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [canLoadOlder, setCanLoadOlder] = useState(true);
  const [replyTo, setReplyTo] = useState<MatrixEvent | null>(null);
  const [editing, setEditing] = useState<MatrixEvent | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(0);

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
    setReplyTo(null);
    setEditing(null);
    setActive(null);
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

  async function attach(files: FileList | File[]) {
    setUploadError("");
    const list = [...files];
    for (const file of list) {
      if (file.size > MAX_FILE_BYTES) {
        setUploadError(`${file.name} is larger than 50 MB.`);
        continue;
      }
      setUploading((n) => n + 1);
      atBottom.current = true;
      try {
        await sendFile(client, room, file, replyTo ?? undefined);
        setReplyTo(null);
      } catch (e) {
        setUploadError(`${file.name}: ${(e as Error).message}`);
      }
      setUploading((n) => n - 1);
    }
  }

  const typing = room
    .getMembers()
    .filter((m) => m.typing && m.userId !== me)
    .map((m) => m.name);

  const lastOwnText = [...events].reverse().find((e) => e.getSender() === me && !e.isRedacted() && e.getContent().msgtype === MsgType.Text && e.getId());

  return (
    <section
      className={`chat ${dragging ? "dragging" : ""}`}
      aria-label={summary.name}
      onDragOver={(e: DragEvent) => {
        if (!isInvite && e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e: DragEvent) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) void attach(e.dataTransfer.files);
      }}
    >
      <header className="chat-head">
        {showBack && (
          <button className="icon-btn" onClick={onBack} aria-label="Back to chats">
            <Icon name="back" />
          </button>
        )}
        <button className="chat-head-main" onClick={onInfo} aria-label="Chat info">
          <Avatar id={partner ?? room.roomId} name={summary.name} size={34} square={summary.kind === "group"} />
          <span className="chat-title">
            <span className="chat-title-name">
              <h2>{summary.name}</h2>
              {trust === "verified" && (
                <span className="verified" title="Verified">
                  <Icon name="shield" size={14} />
                </span>
              )}
            </span>
            <span className="muted small chat-sub">
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
              {partner && <span>{shortHandle(partner, client.getDomain())}</span>}
            </span>
          </span>
        </button>
        <div className="head-actions">
          <button className="icon-btn" onClick={onInfo} aria-label="Chat info" title="Chat info">
            <Icon name="info" />
          </button>
          <button className={`icon-btn ${crmOpen ? "on" : ""}`} onClick={onToggleCrm} aria-label="Contact details" title="Contact details" aria-pressed={crmOpen}>
            <Icon name="panel" />
          </button>
        </div>
      </header>

      {partner && trust === "changed" && (
        <div className="trust-banner" role="alert">
          <Icon name="warn" size={16} />
          <span>
            <strong>{summary.name}'s security key changed.</strong> They may have a new phone, or someone else may be trying to read this chat. Verify them before sharing anything sensitive.
          </span>
          <span className="row">
            <button className="btn small primary" onClick={() => onVerify(partner)}>Verify</button>
            <button className="btn small" onClick={() => void acceptNewIdentity(client, partner)}>I understand</button>
          </span>
        </div>
      )}

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
            {events.map((ev, i) => {
              const id = ev.getId() ?? ev.getTxnId() ?? String(i);
              return (
                <EventRow
                  key={id}
                  client={client}
                  ev={ev}
                  prev={events[i - 1]}
                  room={room}
                  me={me}
                  active={active === id}
                  onActivate={() => setActive((a) => (a === id ? null : id))}
                  onUnlock={onUnlock}
                  onReply={() => {
                    setEditing(null);
                    setReplyTo(ev);
                    setActive(null);
                  }}
                  onEdit={() => {
                    setReplyTo(null);
                    setEditing(ev);
                    setActive(null);
                  }}
                />
              );
            })}
          </div>
          <p className="typing muted small" aria-live="polite">
            {uploading
              ? `Sending ${uploading === 1 ? "file" : `${uploading} files`}…`
              : typing.length
                ? `${typing.slice(0, 2).join(" and ")} ${typing.length > 1 ? "are" : "is"} typing…`
                : ""}
          </p>
          {uploadError && (
            <p className="alert small composer-alert" role="alert" onClick={() => setUploadError("")}>
              {uploadError}
            </p>
          )}
          <Composer
            client={client}
            room={room}
            replyTo={replyTo}
            editing={editing}
            onCancel={() => {
              setReplyTo(null);
              setEditing(null);
            }}
            onEditLast={() => lastOwnText && setEditing(lastOwnText)}
            onSent={() => {
              atBottom.current = true;
              setReplyTo(null);
              setEditing(null);
            }}
            onFiles={(files) => void attach(files)}
          />
        </>
      )}
      {dragging && <div className="drop-hint">Drop to send{summary.encrypted ? " encrypted" : ""}</div>}
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
    return m !== prev && (m === "join" || m === "invite" || m === "leave" || m === "ban");
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

interface RowProps {
  client: MatrixClient;
  ev: MatrixEvent;
  prev?: MatrixEvent;
  room: Room;
  me: string | null;
  active: boolean;
  onActivate: () => void;
  onUnlock: () => void;
  onReply: () => void;
  onEdit: () => void;
}

function EventRow({ client, ev, prev, room, me, active, onActivate, onUnlock, onReply, onEdit }: RowProps) {
  const [picker, setPicker] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const ts = ev.getTs();
  const newDay = !prev || !sameDay(prev.getTs(), ts);
  const sender = ev.getSender() ?? "";
  const name = room.getMember(sender)?.name ?? sender;
  const t = ev.getType();

  useEffect(() => {
    if (!active) {
      setPicker(false);
      setConfirmDelete(false);
    }
  }, [active]);

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
    else if (c.membership === "ban") text = `${name} removed ${target} and blocked them from rejoining`;
    else if (c.membership === "leave") text = sender === ev.getStateKey() ? `${target} left` : `${name} removed ${target}`;
    return (
      <>
        {day}
        <p className="notice muted small">{text}</p>
      </>
    );
  }

  const content = ev.getContent() as { body?: string; msgtype?: string };
  if (content.msgtype === "m.key.verification.request") {
    return (
      <>
        {day}
        <p className="notice muted small">
          <Icon name="shield" size={12} /> {sender === me ? "You" : name} asked to verify {sender === me ? "them" : "you"}
        </p>
      </>
    );
  }

  const mine = sender === me;
  const grouped =
    !newDay &&
    prev?.getSender() === sender &&
    (prev.getType() === EventType.RoomMessage || prev.getType() === EventType.RoomMessageEncrypted) &&
    prev.getContent().msgtype !== "m.key.verification.request" &&
    ts - prev.getTs() < 5 * 60e3;
  const pending = ev.status === EventStatus.SENDING || ev.status === EventStatus.QUEUED || ev.status === EventStatus.ENCRYPTING;
  const failed = ev.status === EventStatus.NOT_SENT;
  const usable = !ev.isRedacted() && !ev.isDecryptionFailure() && !ev.isBeingDecrypted() && ev.getType() === EventType.RoomMessage && Boolean(ev.getId()) && !pending;
  const replyId = replyTargetId(ev);
  const replied = replyId ? room.findEventById(replyId) : undefined;
  const reactions = usable ? reactionsFor(client, room, ev) : [];

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
  else if (content.msgtype === MsgType.Emote) body = <em>* {name} {messageText(ev)}</em>;
  else if (isFileEvent(ev)) body = <FileView client={client} ev={ev} />;
  else body = <Linkified text={messageText(ev)} />;

  return (
    <>
      {day}
      <div className={`msg ${mine ? "mine" : ""} ${grouped ? "grouped" : ""} ${pending ? "pending" : ""} ${active ? "active" : ""}`} data-event-id={ev.getId()}>
        {!grouped && (
          <div className="msg-meta">
            <span className="sender">{mine ? "You" : name}</span>
            <time className="muted small" dateTime={new Date(ts).toISOString()}>
              {new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
            </time>
          </div>
        )}
        <div className="bubble-wrap">
          <div
            className={`bubble ${content.msgtype === MsgType.Notice ? "notice-msg" : ""} ${isFileEvent(ev) && !ev.isRedacted() ? "file-bubble" : ""}`}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("a, button")) return;
              if (usable) onActivate();
            }}
          >
            {replyId && (
              <span className="reply-quote">
                <span className="reply-quote-name">{replied ? (replied.getSender() === me ? "You" : room.getMember(replied.getSender() ?? "")?.name) : "Reply"}</span>
                <span className="reply-quote-text">{snippet(replied)}</span>
              </span>
            )}
            {body}
            {usable && isEdited(ev) && <span className="edited muted small"> (edited)</span>}
          </div>
          {usable && (
            <div className="msg-actions" role="toolbar" aria-label="Message actions">
              {confirmDelete ? (
                <>
                  <span className="small">Delete for everyone?</span>
                  <button className="btn small danger" onClick={() => void deleteMessage(client, room, ev).finally(onActivate)}>Delete</button>
                  <button className="btn small" onClick={() => setConfirmDelete(false)}>Keep</button>
                </>
              ) : picker ? (
                QUICK_REACTIONS.map((k) => (
                  <button
                    key={k}
                    className="react-pick"
                    aria-label={`React ${k}`}
                    onClick={() => {
                      setPicker(false);
                      void toggleReaction(client, room, ev, k);
                    }}
                  >
                    {k}
                  </button>
                ))
              ) : (
                <>
                  <button className="icon-btn sm" onClick={() => setPicker(true)} aria-label="React" title="React">
                    <Icon name="smile" size={16} />
                  </button>
                  <button className="icon-btn sm" onClick={onReply} aria-label="Reply" title="Reply">
                    <Icon name="reply" size={16} />
                  </button>
                  {mine && content.msgtype === MsgType.Text && (
                    <button className="icon-btn sm" onClick={onEdit} aria-label="Edit" title="Edit">
                      <Icon name="edit" size={16} />
                    </button>
                  )}
                  {mine && (
                    <button className="icon-btn sm" onClick={() => setConfirmDelete(true)} aria-label="Delete" title="Delete">
                      <Icon name="trash" size={16} />
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        {reactions.length > 0 && (
          <div className="reactions">
            {reactions.map((r) => (
              <button
                key={r.key}
                className={`reaction ${r.mine ? "on" : ""}`}
                title={r.names.join(", ")}
                aria-pressed={Boolean(r.mine)}
                onClick={() => void toggleReaction(client, room, ev, r.key)}
              >
                <span>{r.key}</span> <span className="small">{r.count}</span>
              </button>
            ))}
          </div>
        )}
        {failed && <p className="err small">Not sent. Check your connection; it will retry.</p>}
      </div>
    </>
  );
}

function FileView({ client, ev }: { client: MatrixClient; ev: MatrixEvent }) {
  const c = ev.getContent() as { body?: string; msgtype?: string; info?: { mimetype?: string; size?: number; w?: number; h?: number } };
  const isImage = c.msgtype === MsgType.Image && /^image\/(png|jpe?g|gif|webp)$/.test(c.info?.mimetype ?? "");
  const small = (c.info?.size ?? 0) < 15 * 1024 * 1024;
  const { url, error, load } = useFile(client, ev, isImage && small);
  const pendingDownload = useRef(false);

  useEffect(() => {
    if (url && pendingDownload.current) {
      pendingDownload.current = false;
      const a = document.createElement("a");
      a.href = url;
      a.download = c.body || "file";
      a.click();
    }
  }, [url, c.body]);

  if (isImage && small) {
    const ratio = c.info?.w && c.info?.h ? `${c.info.w} / ${c.info.h}` : undefined;
    return (
      <span className="image-wrap" style={{ aspectRatio: ratio }}>
        {url ? (
          <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${c.body}`}>
            <img src={url} alt={c.body ?? "Photo"} />
          </a>
        ) : (
          <span className="muted small image-loading">{error ?? "Loading photo…"}</span>
        )}
      </span>
    );
  }
  return (
    <span className="file-card">
      <Icon name="file" size={22} />
      <span className="file-meta">
        <span className="file-name">{c.body}</span>
        <span className="muted small">{error ?? formatBytes(c.info?.size)}</span>
      </span>
      <button
        className="icon-btn sm"
        aria-label={`Download ${c.body}`}
        title="Download"
        onClick={() => {
          if (url) {
            pendingDownload.current = true;
            const a = document.createElement("a");
            a.href = url;
            a.download = c.body || "file";
            a.click();
            pendingDownload.current = false;
          } else {
            pendingDownload.current = true;
            load();
          }
        }}
      >
        <Icon name="download" size={18} />
      </button>
    </span>
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

interface ComposerProps {
  client: MatrixClient;
  room: Room;
  replyTo: MatrixEvent | null;
  editing: MatrixEvent | null;
  onCancel: () => void;
  onEditLast: () => void;
  onSent: () => void;
  onFiles: (files: FileList | File[]) => void;
}

function Composer({ client, room, replyTo, editing, onCancel, onEditLast, onSent, onFiles }: ComposerProps) {
  const [text, setText] = useState("");
  const typingUntil = useRef(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  const me = client.getUserId();

  useEffect(() => {
    setText("");
    input.current?.focus();
  }, [room.roomId]);

  useEffect(() => {
    if (editing) setText(messageText(editing));
    if (editing || replyTo) input.current?.focus();
  }, [editing, replyTo]);

  function send() {
    const body = text.trim();
    if (!body) return;
    setText("");
    typingUntil.current = 0;
    void client.sendTyping(room.roomId, false, 0).catch(() => undefined);
    void sendText(client, room, body, { replyTo: replyTo ?? undefined, edit: editing ?? undefined }).catch(() => undefined);
    onSent();
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    } else if (e.key === "Escape" && (editing || replyTo)) {
      e.preventDefault();
      setText("");
      onCancel();
    } else if (e.key === "ArrowUp" && !text) {
      e.preventDefault();
      onEditLast();
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

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = [...e.clipboardData.files];
    if (files.length) {
      e.preventDefault();
      onFiles(files);
    }
  }

  const target = editing ?? replyTo;
  return (
    <div className="composer-wrap">
      {target && (
        <div className="composer-context">
          <Icon name={editing ? "edit" : "reply"} size={14} />
          <span className="composer-context-text">
            <strong>{editing ? "Editing" : `Replying to ${target.getSender() === me ? "yourself" : (room.getMember(target.getSender() ?? "")?.name ?? "")}`}</strong>
            <span className="muted"> {snippet(target)}</span>
          </span>
          <button
            className="icon-btn sm"
            aria-label="Cancel"
            onClick={() => {
              if (editing) setText("");
              onCancel();
            }}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          ref={filePicker}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) onFiles(e.target.files);
            e.target.value = "";
          }}
        />
        {!editing && (
          <button type="button" className="icon-btn attach" aria-label="Attach a file or photo" title="Attach a file or photo" onClick={() => filePicker.current?.click()}>
            <Icon name="clip" />
          </button>
        )}
        <textarea
          ref={input}
          rows={1}
          value={text}
          placeholder={editing ? "Edit message" : `Message ${room.name}`}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKey}
          onPaste={onPaste}
          aria-label="Message"
        />
        <button className="icon-btn send" aria-label={editing ? "Save edit" : "Send"} disabled={!text.trim()}>
          <Icon name={editing ? "check" : "send"} />
        </button>
      </form>
    </div>
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
        {inviter ? ` · ${shortHandle(inviter, client.getDomain())}` : ""}
        {network ? ` · ${network.name}` : ""}
      </p>
      {error && <p className="alert">{error}</p>}
      <div className="row wrap">
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
        {inviter && (
          <button
            className="btn ghost"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await client.leave(room.roomId).catch(() => undefined);
              await client.setIgnoredUsers([...new Set([...client.getIgnoredUsers(), inviter])]).catch(() => undefined);
              onLeft();
            }}
          >
            Decline and block
          </button>
        )}
      </div>
    </div>
  );
}
