/**
 * Desktop/phone notifications while Konnect is open (also in a background tab or an installed app).
 * Inside KuartalOS, the OS shows notifications instead. Preference is per device.
 */
const KEY = "konnect.notifications.v1";

export type NotifyPref = "off" | "full" | "private";

export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function getNotifyPref(): NotifyPref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "full" || v === "private") return Notification.permission === "granted" ? v : "off";
  } catch {
    /* storage blocked */
  }
  return "off";
}

export async function setNotifyPref(pref: NotifyPref): Promise<NotifyPref> {
  if (pref !== "off" && notificationsSupported() && Notification.permission !== "granted") {
    const result = await Notification.requestPermission();
    if (result !== "granted") pref = "off";
  }
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    /* storage blocked: the choice lasts for this visit */
  }
  return pref;
}

export function showNotification(title: string, body: string, tag: string, onClick: () => void): void {
  const pref = getNotifyPref();
  if (pref === "off") return;
  try {
    const n = new Notification(title, {
      body: pref === "private" ? "New message" : body,
      tag,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
    });
    n.onclick = () => {
      window.focus();
      onClick();
      n.close();
    };
  } catch {
    /* some mobile browsers only allow notifications from a service worker */
  }
}

/** Unread count on the installed app's icon, where supported. */
export function setAppBadge(count: number): void {
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try {
    if (count > 0) void nav.setAppBadge?.(count)?.catch(() => undefined);
    else void nav.clearAppBadge?.()?.catch(() => undefined);
  } catch {
    /* unsupported */
  }
}
