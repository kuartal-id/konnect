/**
 * Talks to the KuartalOS shell when Konnect runs inside a KuartalOS window.
 * This is a small copy of `@kuartal/os-sdk` (kuartal-id/kuartalos, packages/sdk, protocol v1),
 * kept here until that package is published. Keep the message shapes identical.
 */

const PROTOCOL_VERSION = 1;

export interface KuartalOS {
  theme: "light" | "dark";
  supports: string[];
  setTitle(title: string): void;
  notify(text: string, level?: "info" | "success" | "error"): void;
}

let counter = 0;
const nextId = () => `k${Date.now().toString(36)}${(counter++).toString(36)}`;

/** Resolves with an OS handle, or null when Konnect is open in a normal browser tab. */
export function connectToKuartalOS(timeoutMs = 1500): Promise<KuartalOS | null> {
  if (typeof window === "undefined" || window.parent === window) return Promise.resolve(null);

  return new Promise((resolve) => {
    const id = nextId();
    const onMessage = (event: MessageEvent) => {
      const msg = event.data as { kuartal?: number; id?: string; type?: string; payload?: Record<string, unknown> };
      if (event.source !== window.parent || msg?.kuartal !== PROTOCOL_VERSION) return;
      if (msg.type !== "welcome" || msg.id !== id) return;
      const origin = event.origin;
      cleanup();
      const post = (type: string, payload: unknown) =>
        window.parent.postMessage({ kuartal: PROTOCOL_VERSION, id: nextId(), type, payload }, origin);
      const supports = Array.isArray(msg.payload?.supports) ? (msg.payload?.supports as string[]) : [];
      resolve({
        theme: msg.payload?.theme === "dark" ? "dark" : "light",
        supports,
        setTitle: (title) => post("window.setTitle", { title }),
        notify: (text, level = "info") => {
          if (supports.includes("notify")) post("notify", { text, level });
        },
      });
    };
    const timer = window.setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);
    function cleanup() {
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
    }
    window.addEventListener("message", onMessage);
    window.parent.postMessage({ kuartal: PROTOCOL_VERSION, id, type: "hello", payload: { app: "konnect" } }, "*");
  });
}
