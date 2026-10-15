import { colorFor, initials } from "../lib/rooms";

export function Avatar({ id, name, size = 36, square = false }: { id: string; name: string; size?: number; square?: boolean }) {
  return (
    <span
      className="avatar"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
        background: colorFor(id),
        borderRadius: square ? Math.round(size * 0.28) : "50%",
      }}
    >
      {initials(name) || "?"}
    </span>
  );
}

/** Small line icons, stroke-only, drawn to match the KuartalOS shell. */
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...common}>
      {PATHS[name]}
    </svg>
  );
}

export type IconName = "chat" | "contacts" | "plus" | "lock" | "send" | "back" | "panel" | "search" | "settings" | "shield" | "user-plus" | "close" | "link";

const PATHS: Record<IconName, JSX.Element> = {
  chat: <path d="M4 5h16v11H9l-5 4z" />,
  contacts: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19c.8-3 3-4.6 5.5-4.6s4.7 1.6 5.5 4.6M16 5.5a3 3 0 0 1 0 5.6M18 14.6c1.4.6 2.3 2 2.6 4.4" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  send: <path d="M4 12 20 4l-6 16-3-7z" />,
  back: <path d="M15 5l-7 7 7 7" />,
  panel: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M15 4v16" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m16 16 4 4" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" />
    </>
  ),
  shield: <path d="M12 3 5 6v6c0 4.2 3 7.4 7 9 4-1.6 7-4.8 7-9V6z" />,
  "user-plus": (
    <>
      <circle cx="10" cy="8" r="3.4" />
      <path d="M3.5 20c.8-3.4 3.4-5.2 6.5-5.2 1.4 0 2.6.3 3.7 1M18 13v6M15 16h6" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
};
