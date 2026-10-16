/** Helpers for turning Matrix rooms into what Konnect shows: chats, groups, workspaces, networks. */
import {
  EventType,
  KnownMembership,
  Preset,
  Visibility,
  type MatrixClient,
  type MatrixEvent,
  type Room,
} from "matrix-js-sdk";

export type ChatKind = "direct" | "group";

/** Networks a bridge can connect. Bridges (mautrix-*) mark their rooms with an `m.bridge` state event. */
export interface Network {
  id: string;
  name: string;
}

const KNOWN_NETWORKS: Record<string, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Messenger",
  meta: "Meta",
  telegram: "Telegram",
  signal: "Signal",
  linkedin: "LinkedIn",
  discord: "Discord",
  slack: "Slack",
  gmessages: "SMS",
  twitter: "X",
};

export function roomNetwork(room: Room): Network | null {
  for (const type of ["m.bridge", "uk.half-shot.bridge"]) {
    const events = room.currentState.getStateEvents(type);
    for (const ev of events) {
      const protocol = ev.getContent()?.protocol as { id?: string; displayname?: string } | undefined;
      if (protocol?.id) {
        const id = protocol.id.toLowerCase();
        return { id, name: KNOWN_NETWORKS[id] ?? protocol.displayname ?? protocol.id };
      }
    }
  }
  return null;
}

function directRoomIds(client: MatrixClient): Set<string> {
  const content = (client.getAccountData(EventType.Direct)?.getContent() ?? {}) as Record<string, string[]>;
  return new Set(Object.values(content).flat());
}

export function chatKind(client: MatrixClient, room: Room, directIds = directRoomIds(client)): ChatKind {
  if (directIds.has(room.roomId)) return "direct";
  if (room.getMyMembership() === KnownMembership.Invite && room.getDMInviter()) return "direct";
  return "group";
}

/** The other person in a direct chat. */
export function directPartner(client: MatrixClient, room: Room): string | null {
  const me = client.getUserId();
  const others = room
    .getMembers()
    .filter((m) => m.userId !== me && (m.membership === KnownMembership.Join || m.membership === KnownMembership.Invite));
  if (others.length === 1) return others[0].userId;
  const guess = room.guessDMUserId();
  return guess && guess !== me ? guess : null;
}

export interface ChatSummary {
  room: Room;
  kind: ChatKind;
  name: string;
  preview: string;
  ts: number;
  unread: number;
  network: Network | null;
  encrypted: boolean;
}

export function summarize(client: MatrixClient, room: Room, directIds = directRoomIds(client)): ChatSummary {
  const events = room.getLiveTimeline().getEvents();
  let preview = "";
  for (let i = events.length - 1; i >= 0; i--) {
    const p = previewOf(events[i], client);
    if (p) {
      preview = p;
      break;
    }
  }
  return {
    room,
    kind: chatKind(client, room, directIds),
    name: room.name || "Untitled chat",
    preview,
    ts: room.getLastActiveTimestamp() || 0,
    unread: room.getUnreadNotificationCount(),
    network: roomNetwork(room),
    encrypted: room.hasEncryptionStateEvent(),
  };
}

function previewOf(ev: MatrixEvent, client: MatrixClient): string {
  if (ev.isRedacted()) return "";
  const mine = ev.getSender() === client.getUserId();
  if (ev.isDecryptionFailure()) return "Locked message";
  if (ev.getType() === EventType.RoomMessageEncrypted) return "";
  if (ev.getType() !== EventType.RoomMessage) return "";
  if (ev.isRelation("m.replace")) return "";
  const c = ev.getContent() as { body?: string; msgtype?: string };
  if (c.msgtype === "m.key.verification.request") return "Security verification";
  const body = c.msgtype === "m.image" ? "Photo" : c.msgtype === "m.file" ? "File" : c.body ?? "";
  return mine ? `You: ${body}` : body;
}

export function listChats(client: MatrixClient): { chats: ChatSummary[]; invites: ChatSummary[]; workspaces: Room[] } {
  const directIds = directRoomIds(client);
  const chats: ChatSummary[] = [];
  const invites: ChatSummary[] = [];
  const workspaces: Room[] = [];
  for (const room of client.getRooms()) {
    const membership = room.getMyMembership();
    if (room.isSpaceRoom()) {
      if (membership === KnownMembership.Join) workspaces.push(room);
      continue;
    }
    if (membership === KnownMembership.Join) chats.push(summarize(client, room, directIds));
    else if (membership === KnownMembership.Invite) invites.push(summarize(client, room, directIds));
  }
  chats.sort((a, b) => b.ts - a.ts);
  workspaces.sort((a, b) => a.name.localeCompare(b.name));
  return { chats, invites, workspaces };
}

/** Room IDs listed as children of a workspace. */
export function workspaceChildren(space: Room): Set<string> {
  const ids = new Set<string>();
  for (const ev of space.currentState.getStateEvents(EventType.SpaceChild)) {
    const via = (ev.getContent() as { via?: string[] }).via;
    if (Array.isArray(via) && via.length > 0) ids.add(ev.getStateKey() ?? "");
  }
  return ids;
}

const encryptionState = {
  type: EventType.RoomEncryption,
  state_key: "",
  content: { algorithm: "m.megolm.v1.aes-sha2" },
};

async function markDirect(client: MatrixClient, userId: string, roomId: string): Promise<void> {
  const current = (client.getAccountData(EventType.Direct)?.getContent() ?? {}) as Record<string, string[]>;
  const list = new Set(current[userId] ?? []);
  list.add(roomId);
  await client.setAccountData(EventType.Direct, { ...current, [userId]: [...list] });
}

/** Opens the existing 1:1 chat with someone, or starts an encrypted one. */
export async function openDirectChat(client: MatrixClient, userId: string): Promise<string> {
  const current = (client.getAccountData(EventType.Direct)?.getContent() ?? {}) as Record<string, string[]>;
  for (const roomId of current[userId] ?? []) {
    const room = client.getRoom(roomId);
    if (room && room.getMyMembership() === KnownMembership.Join) return roomId;
  }
  const { room_id } = await client.createRoom({
    is_direct: true,
    invite: [userId],
    preset: Preset.TrustedPrivateChat,
    visibility: Visibility.Private,
    initial_state: [encryptionState],
  });
  await markDirect(client, userId, room_id);
  return room_id;
}

/** When someone invites us to a 1:1 chat, accepting it should also file it as a direct chat. */
export async function acceptInvite(client: MatrixClient, room: Room): Promise<void> {
  const inviter = room.getDMInviter();
  await client.joinRoom(room.roomId);
  if (inviter) await markDirect(client, inviter, room.roomId);
}

export async function createGroup(
  client: MatrixClient,
  name: string,
  invite: string[],
  workspace?: Room | null,
): Promise<string> {
  const server = client.getDomain() ?? "";
  const initialState: { type: string; state_key: string; content: Record<string, unknown> }[] = [encryptionState];
  if (workspace) {
    initialState.push({ type: EventType.SpaceParent, state_key: workspace.roomId, content: { via: [server], canonical: true } });
  }
  const { room_id } = await client.createRoom({
    name,
    invite,
    preset: Preset.PrivateChat,
    visibility: Visibility.Private,
    initial_state: initialState,
  });
  if (workspace) {
    await client.sendStateEvent(workspace.roomId, EventType.SpaceChild, { via: [server], suggested: true }, room_id);
  }
  return room_id;
}

/** A workspace is a Matrix space: a container for a team's chats, like a Slack workspace or Discord server. */
export async function createWorkspace(client: MatrixClient, name: string): Promise<string> {
  const { room_id } = await client.createRoom({
    name,
    preset: Preset.PrivateChat,
    visibility: Visibility.Private,
    creation_content: { type: "m.space" },
    power_level_content_override: { events_default: 100 },
  });
  return room_id;
}

/** Accepts "@name:server", "name:server" or just "name" (assumed to be on our own server). */
export function normalizeUserId(input: string, ownDomain: string | null): string | null {
  let v = input.trim();
  if (!v) return null;
  if (!v.startsWith("@")) v = `@${v}`;
  if (!v.includes(":") && ownDomain) v = `${v}:${ownDomain}`;
  return /^@[^:\s]+:[^\s]+$/.test(v) ? v : null;
}

export function initials(name: string): string {
  const clean = name.replace(/^[@#!]/, "").trim();
  const parts = clean.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : clean.slice(0, 2);
  return letters.toUpperCase();
}

const PALETTE = ["#0f766e", "#15803d", "#b45309", "#1d4ed8", "#be123c", "#0e7490", "#4d7c0f", "#a16207"];
export function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
