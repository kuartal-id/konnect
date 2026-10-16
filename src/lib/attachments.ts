/**
 * Files and photos.
 *
 * In encrypted chats every file is encrypted in the browser before upload (AES-256-CTR with a fresh
 * key per file, plus a SHA-256 of the ciphertext), exactly as the Matrix spec's "encrypted
 * attachments" describe, so other Matrix apps can open them too. The key travels inside the
 * end-to-end encrypted message; the server only ever stores ciphertext.
 */
import { useEffect, useState } from "react";
import { EventType, MsgType, type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk";

export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export interface EncryptedFile {
  url: string;
  key: { kty: "oct"; key_ops: string[]; alg: "A256CTR"; k: string; ext: true };
  iv: string;
  hashes: { sha256: string };
  v: "v2";
}

interface FileContent {
  msgtype: string;
  body: string;
  url?: string;
  file?: EncryptedFile;
  info?: { mimetype?: string; size?: number; w?: number; h?: number };
}

const b64 = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (s: string) => {
  const std = s.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(std + "===".slice((std.length + 3) % 4)), (c) => c.charCodeAt(0));
};

async function encrypt(data: ArrayBuffer): Promise<{ cipher: ArrayBuffer; info: Omit<EncryptedFile, "url"> }> {
  const key = await crypto.subtle.generateKey({ name: "AES-CTR", length: 256 }, true, ["encrypt", "decrypt"]);
  const iv = new Uint8Array(16);
  crypto.getRandomValues(iv.subarray(0, 8)); // top 64 bits random, counter starts at 0 (spec)
  const cipher = await crypto.subtle.encrypt({ name: "AES-CTR", counter: iv, length: 64 }, key, data);
  const jwk = await crypto.subtle.exportKey("jwk", key);
  const hash = await crypto.subtle.digest("SHA-256", cipher);
  return {
    cipher,
    info: {
      key: { kty: "oct", key_ops: ["encrypt", "decrypt"], alg: "A256CTR", k: jwk.k ?? "", ext: true },
      iv: b64(iv).replace(/=+$/, ""),
      hashes: { sha256: b64(hash).replace(/=+$/, "") },
      v: "v2",
    },
  };
}

async function decrypt(cipher: ArrayBuffer, file: EncryptedFile): Promise<ArrayBuffer> {
  const hash = b64(await crypto.subtle.digest("SHA-256", cipher)).replace(/=+$/, "");
  if (hash !== file.hashes?.sha256?.replace(/=+$/, "")) throw new Error("This file was changed or damaged.");
  const key = await crypto.subtle.importKey("jwk", { kty: "oct", k: file.key.k, alg: "A256CTR", ext: true }, "AES-CTR", false, ["decrypt"]);
  return crypto.subtle.decrypt({ name: "AES-CTR", counter: unb64(file.iv), length: 64 }, key, cipher);
}

async function imageSize(file: File): Promise<{ w: number; h: number } | undefined> {
  if (!file.type.startsWith("image/")) return undefined;
  try {
    const bmp = await createImageBitmap(file);
    const size = { w: bmp.width, h: bmp.height };
    bmp.close();
    return size;
  } catch {
    return undefined;
  }
}

export async function sendFile(client: MatrixClient, room: Room, file: File, replyTo?: MatrixEvent): Promise<void> {
  if (file.size > MAX_FILE_BYTES) throw new Error("Files can be up to 50 MB.");
  const encrypted = room.hasEncryptionStateEvent();
  const isImage = /^image\/(png|jpe?g|gif|webp)$/.test(file.type);
  const info: FileContent["info"] = { mimetype: file.type || "application/octet-stream", size: file.size, ...(isImage ? await imageSize(file) : {}) };

  const content: FileContent & Record<string, unknown> = { msgtype: isImage ? MsgType.Image : MsgType.File, body: file.name, info };
  if (encrypted) {
    const { cipher, info: keys } = await encrypt(await file.arrayBuffer());
    const { content_uri } = await client.uploadContent(new Blob([cipher], { type: "application/octet-stream" }), {
      name: "encrypted",
      type: "application/octet-stream",
      includeFilename: false,
    });
    content.file = { url: content_uri, ...keys };
  } else {
    const { content_uri } = await client.uploadContent(file, { name: file.name, type: info.mimetype });
    content.url = content_uri;
  }
  if (replyTo?.getId()) content["m.relates_to"] = { "m.in_reply_to": { event_id: replyTo.getId() } };
  await client.sendEvent(room.roomId, EventType.RoomMessage, content as never);
}

export function isFileEvent(ev: MatrixEvent): boolean {
  const c = ev.getContent() as FileContent;
  return [MsgType.Image, MsgType.File, MsgType.Video, MsgType.Audio].includes(c.msgtype as MsgType) && Boolean(c.file?.url || c.url);
}

/** Downloads (and decrypts) a file once per page; returns an object URL the browser can show or save. */
const cache = new Map<string, Promise<string>>();

export function loadFile(client: MatrixClient, ev: MatrixEvent): Promise<string> {
  const c = ev.getContent() as FileContent;
  const mxc = c.file?.url ?? c.url ?? "";
  let pending = cache.get(mxc);
  if (!pending) {
    pending = (async () => {
      const http = client.mxcUrlToHttp(mxc, undefined, undefined, undefined, false, true, true);
      if (!http) throw new Error("Unknown file address.");
      const res = await fetch(http, { headers: { Authorization: `Bearer ${client.getAccessToken() ?? ""}` } });
      if (!res.ok) throw new Error(res.status === 404 ? "This file is no longer available." : "Couldn't download the file.");
      const data = await res.arrayBuffer();
      const plain = c.file ? await decrypt(data, c.file) : data;
      // Never trust the sender's MIME type for anything risky: only common images render inline.
      const type = c.info?.mimetype ?? "application/octet-stream";
      const safeType = /^image\/(png|jpe?g|gif|webp)$/.test(type) ? type : "application/octet-stream";
      return URL.createObjectURL(new Blob([plain], { type: safeType }));
    })();
    pending.catch(() => cache.delete(mxc));
    cache.set(mxc, pending);
  }
  return pending;
}

export function useFile(client: MatrixClient, ev: MatrixEvent, auto: boolean): { url?: string; error?: string; load: () => void } {
  const [state, setState] = useState<{ url?: string; error?: string }>({});
  const [want, setWant] = useState(auto);
  useEffect(() => {
    if (!want) return;
    let live = true;
    loadFile(client, ev).then(
      (url) => live && setState({ url }),
      (e: Error) => live && setState({ error: e.message }),
    );
    return () => {
      live = false;
    };
  }, [client, ev, want]);
  return { ...state, load: () => setWant(true) };
}

export function formatBytes(n?: number): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

