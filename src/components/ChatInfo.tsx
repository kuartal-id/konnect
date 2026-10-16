import { useState } from "react";
import { EventType, KnownMembership, type MatrixClient, type Room } from "matrix-js-sdk";
import { Modal } from "./Dialogs";
import { Avatar, Icon } from "./Avatar";
import { directPartner, summarize } from "../lib/rooms";
import { shortHandle } from "../lib/discovery";
import { useTrust, type Trust } from "../lib/trust";
import { errorText } from "../App";

interface Props {
  client: MatrixClient;
  room: Room;
  onClose: () => void;
  onInvite: () => void;
  onVerify: (userId: string) => void;
  onLeft: () => void;
}

export function ChatInfo({ client, room, onClose, onInvite, onVerify, onLeft }: Props) {
  const me = client.getSafeUserId();
  const domain = client.getDomain();
  const summary = summarize(client, room);
  const partner = summary.kind === "direct" ? directPartner(client, room) : null;
  const trust = useTrust(client, partner);
  const [name, setName] = useState(room.name);
  const [confirm, setConfirm] = useState<"leave" | "block" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canRename = summary.kind === "group" && room.currentState.maySendStateEvent(EventType.RoomName, me);
  const canInvite = summary.kind === "group" && room.canInvite(me);
  const members = room
    .getMembers()
    .filter((m) => m.membership === KnownMembership.Join || m.membership === KnownMembership.Invite)
    .sort((a, b) => Number(b.userId === me) - Number(a.userId === me) || a.name.localeCompare(b.name));

  async function run(fn: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    setError("");
    try {
      await fn();
      after?.();
    } catch (e) {
      setError(errorText(e));
    }
    setBusy(false);
  }

  const leave = () =>
    run(
      () => client.leave(room.roomId),
      () => {
        onClose();
        onLeft();
      },
    );
  const block = () =>
    run(
      async () => {
        if (!partner) return;
        await client.setIgnoredUsers([...new Set([...client.getIgnoredUsers(), partner])]);
        await client.leave(room.roomId);
      },
      () => {
        onClose();
        onLeft();
      },
    );

  return (
    <Modal title={summary.kind === "direct" ? "Chat info" : "Group info"} onClose={onClose} wide>
      <div className="settings">
        <section className="info-head">
          <Avatar id={partner ?? room.roomId} name={summary.name} size={56} square={summary.kind === "group"} />
          <div>
            <h3 className="info-name">{summary.name}</h3>
            {partner && <p className="muted small">{shortHandle(partner, domain)}</p>}
            <p className="small enc">
              <Icon name="lock" size={12} /> {summary.encrypted ? "End-to-end encrypted" : "Not end-to-end encrypted"}
            </p>
          </div>
        </section>

        {partner && (
          <section>
            <h3>Security</h3>
            <TrustLine trust={trust} name={summary.name} />
            {trust !== "verified" && (
              <button className="btn primary" disabled={busy} onClick={() => onVerify(partner)}>
                <Icon name="shield" size={16} /> Verify {summary.name}
              </button>
            )}
          </section>
        )}

        {canRename && (
          <section>
            <h3>Name</h3>
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim() && name.trim() !== room.name) void run(() => client.setRoomName(room.roomId, name.trim()));
              }}
            >
              <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Group name" className="grow" />
              <button className="btn" disabled={busy || !name.trim() || name.trim() === room.name}>Save</button>
            </form>
          </section>
        )}

        {summary.kind === "group" && (
          <section>
            <div className="row between">
              <h3>{members.length === 1 ? "1 member" : `${members.length} members`}</h3>
              {canInvite && (
                <button className="btn small" onClick={onInvite}>
                  <Icon name="user-plus" size={14} /> Invite
                </button>
              )}
            </div>
            <ul className="member-list">
              {members.map((m) => (
                <li key={m.userId} className="member-row">
                  <Avatar id={m.userId} name={m.name} size={32} />
                  <span className="contact-main">
                    <span className="contact-name">
                      {m.userId === me ? "You" : m.name}
                      {m.powerLevel >= 100 && <span className="muted small"> · admin</span>}
                    </span>
                    <span className="muted small">
                      {shortHandle(m.userId, domain)}
                      {m.membership === KnownMembership.Invite ? " · invited" : ""}
                    </span>
                  </span>
                  {m.userId !== me && <MemberTrust client={client} userId={m.userId} />}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          {confirm === "leave" ? (
            <div className="stack">
              <p className="small">
                {summary.kind === "group"
                  ? "You'll stop getting messages from this group. Someone has to invite you again to rejoin."
                  : "This chat will disappear from your list. They can message you again later."}
              </p>
              <div className="row">
                <button className="btn danger" disabled={busy} onClick={() => void leave()}>Leave</button>
                <button className="btn" onClick={() => setConfirm(null)}>Cancel</button>
              </div>
            </div>
          ) : confirm === "block" ? (
            <div className="stack">
              <p className="small">
                You won't see messages or invites from {summary.name} anywhere in Konnect, and this chat will be removed. You can unblock them in Settings.
              </p>
              <div className="row">
                <button className="btn danger" disabled={busy} onClick={() => void block()}>Block</button>
                <button className="btn" onClick={() => setConfirm(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div className="row wrap">
              <button className="btn" onClick={() => setConfirm("leave")}>{summary.kind === "group" ? "Leave group" : "Leave chat"}</button>
              {partner && (
                <button className="btn danger-outline" onClick={() => setConfirm("block")}>
                  Block {summary.name}
                </button>
              )}
            </div>
          )}
          {error && <p className="alert small">{error}</p>}
        </section>
      </div>
    </Modal>
  );
}

function TrustLine({ trust, name }: { trust: Trust; name: string }) {
  if (trust === "verified")
    return (
      <p className="small ok-text">
        <Icon name="shield" size={14} /> You've verified {name}. Konnect will warn you if their security key changes.
      </p>
    );
  if (trust === "changed")
    return (
      <p className="small warn-text">
        <Icon name="warn" size={14} /> {name}'s security key changed since you last checked. Verify them again.
      </p>
    );
  return <p className="muted small">Messages are encrypted. Verify {name} to make sure no one else is in between: you'll compare seven emoji, in person or on a call.</p>;
}

function MemberTrust({ client, userId }: { client: MatrixClient; userId: string }) {
  const trust = useTrust(client, userId);
  if (trust === "verified")
    return (
      <span className="verified" title="Verified">
        <Icon name="shield" size={14} />
      </span>
    );
  if (trust === "changed")
    return (
      <span className="warn-text" title="Security key changed">
        <Icon name="warn" size={14} />
      </span>
    );
  return null;
}
