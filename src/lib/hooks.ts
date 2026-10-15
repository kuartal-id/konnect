import { useEffect, useState } from "react";
import {
  ClientEvent,
  MatrixEventEvent,
  RoomEvent,
  RoomMemberEvent,
  RoomStateEvent,
  type MatrixClient,
} from "matrix-js-sdk";

/**
 * Re-renders whenever anything visible may have changed: new messages, decryption finishing,
 * names, members, receipts, account data. Batched to one render per animation frame.
 */
export function useClientVersion(client: MatrixClient): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let frame = 0;
    const bump = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setVersion((v) => v + 1);
      });
    };
    // The client re-emits room, member and event updates, so listening on it covers every room.
    const names = [
      ClientEvent.Sync,
      ClientEvent.Room,
      ClientEvent.DeleteRoom,
      ClientEvent.AccountData,
      RoomEvent.Timeline,
      RoomEvent.Name,
      RoomEvent.Receipt,
      RoomEvent.MyMembership,
      RoomEvent.LocalEchoUpdated,
      RoomEvent.TimelineReset,
      RoomStateEvent.Events,
      RoomMemberEvent.Typing,
      MatrixEventEvent.Decrypted,
    ];
    const emitter = client as unknown as { on(n: string, f: () => void): void; off(n: string, f: () => void): void };
    for (const name of names) emitter.on(name, bump);
    return () => {
      cancelAnimationFrame(frame);
      for (const name of names) emitter.off(name, bump);
    };
  }, [client]);
  return version;
}

/** True when the window is narrow enough that Konnect should show one pane at a time. */
export function useNarrow(breakpoint = 760): boolean {
  const [narrow, setNarrow] = useState(() => window.innerWidth < breakpoint);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < breakpoint);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [breakpoint]);
  return narrow;
}
