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

export type IconName =
  | "chat" | "contacts" | "plus" | "lock" | "send" | "back" | "panel" | "search" | "settings" | "shield" | "user-plus" | "close" | "link"
  | "clip" | "reply" | "smile" | "edit" | "trash" | "info" | "check" | "warn" | "file" | "download" | "bell";

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
  clip: <path d="m20 11-8.5 8.5a5 5 0 0 1-7-7L13 4a3.3 3.3 0 0 1 4.7 4.7L9.2 17.2a1.7 1.7 0 0 1-2.4-2.4L14.5 7" />,
  reply: <path d="M10 8 5 12l5 4M5 12h9a5 5 0 0 1 5 5v1" />,
  smile: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 14.5c.9 1.2 2.1 1.8 3.5 1.8s2.6-.6 3.5-1.8M9.3 9.8h.01M14.7 9.8h.01" />
    </>
  ),
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />,
  trash: <path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10.5 11v5M13.5 11v5" />,
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  warn: <path d="M12 4 2.8 19.5h18.4zM12 10v4.5M12 17h.01" />,
  file: <path d="M7 3h7l5 5v13H7zM14 3v5h5" />,
  download: <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14" />,
  bell: <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0" />,
};
