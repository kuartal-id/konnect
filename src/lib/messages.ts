/** Sending text, replies, edits, deletions and reactions, and reading them back for display. */
import { EventType, MsgType, RelationType, type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk";

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "🙏", "🎉", "✅"];

type Relates = { "m.in_reply_to"?: { event_id?: string }; rel_type?: string; event_id?: string; key?: string };

export function replyTargetId(ev: MatrixEvent): string | undefined {
  const rel = ev.getWireContent()["m.relates_to"] as Relates | undefined;
  return (ev.getContent()["m.relates_to"] as Relates | undefined)?.["m.in_reply_to"]?.event_id ?? rel?.["m.in_reply_to"]?.event_id;
}

/** Message text with any old-style quoted reply fallback ("> <@x> ...") from other apps removed. */
export function messageText(ev: MatrixEvent): string {
  const body = String(ev.getContent().body ?? "");
  if (!replyTargetId(ev) || !body.startsWith("> ")) return body;
  const lines = body.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].startsWith("> ")) i++;
  if (lines[i] === "") i++;
  return lines.slice(i).join("\n");
}

export function isEdited(ev: MatrixEvent): boolean {
  return Boolean(ev.replacingEventId());
}

export async function sendText(client: MatrixClient, room: Room, text: string, opts: { replyTo?: MatrixEvent; edit?: MatrixEvent } = {}): Promise<void> {
  const body = text.trim();
  if (!body) return;
  if (opts.edit?.getId()) {
    await client.sendEvent(room.roomId, EventType.RoomMessage, {
      msgtype: MsgType.Text,
      body: `* ${body}`,
      "m.new_content": { msgtype: MsgType.Text, body },
      "m.relates_to": { rel_type: RelationType.Replace, event_id: opts.edit.getId()! },
    } as never);
    return;
  }
  const content: Record<string, unknown> = { msgtype: MsgType.Text, body };
  if (opts.replyTo?.getId()) content["m.relates_to"] = { "m.in_reply_to": { event_id: opts.replyTo.getId() } };
  await client.sendEvent(room.roomId, EventType.RoomMessage, content as never);
}

export async function deleteMessage(client: MatrixClient, room: Room, ev: MatrixEvent): Promise<void> {
  const id = ev.getId();
  if (id) await client.redactEvent(room.roomId, id);
}

export interface ReactionGroup {
  key: string;
  count: number;
  mine?: MatrixEvent;
  names: string[];
}

export function reactionsFor(client: MatrixClient, room: Room, ev: MatrixEvent): ReactionGroup[] {
  const id = ev.getId();
  if (!id) return [];
  const rel = room.relations.getChildEventsForEvent(id, RelationType.Annotation, EventType.Reaction);
  const sorted = rel?.getSortedAnnotationsByKey() ?? [];
  const me = client.getUserId();
  return sorted
    .map(([key, events]) => {
      const live = [...events].filter((e) => !e.isRedacted());
      return {
        key,
        count: live.length,
        mine: live.find((e) => e.getSender() === me),
        names: live.map((e) => room.getMember(e.getSender() ?? "")?.name ?? e.getSender() ?? ""),
      };
    })
    .filter((g) => g.count > 0);
}

export async function toggleReaction(client: MatrixClient, room: Room, ev: MatrixEvent, key: string): Promise<void> {
  const existing = reactionsFor(client, room, ev).find((g) => g.key === key)?.mine;
  if (existing?.getId()) {
    await client.redactEvent(room.roomId, existing.getId()!);
    return;
  }
  await client.sendEvent(room.roomId, EventType.Reaction, {
    "m.relates_to": { rel_type: RelationType.Annotation, event_id: ev.getId()!, key },
  } as never);
}

/** Short one-line preview of a message, for reply quotes. */
export function snippet(ev: MatrixEvent | null | undefined): string {
  if (!ev) return "Original message not loaded";
  if (ev.isRedacted()) return "Message deleted";
  if (ev.isDecryptionFailure()) return "Locked message";
  const c = ev.getContent();
  if (c.msgtype === MsgType.Image) return "Photo";
  if (c.msgtype === MsgType.File) return `File: ${c.body ?? ""}`;
  return messageText(ev).replace(/\s+/g, " ").slice(0, 140);
}
