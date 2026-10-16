/**
 * How people find each other: @handles and verified phone numbers.
 * Talks to the Konnect discovery module on the chat server (server/modules/konnect_discovery.py).
 */
import type { MatrixClient } from "matrix-js-sdk";

export interface DiscoverySettings {
  /** Shown in search by name or @handle. When false, only someone who types the exact @handle reaches you. */
  handle_search: boolean;
  /** Your verified number in masked form, and whether people who know it can find you. */
  phone: { masked: string; lookup: boolean } | null;
  /** False until the server has WhatsApp codes switched on. */
  phone_verification: boolean;
}

export class DiscoveryError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errcode?: string,
  ) {
    super(message);
  }
}

async function call<T>(client: MatrixClient, method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${client.getHomeserverUrl().replace(/\/$/, "")}/_synapse/client/konnect/v1/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${client.getAccessToken() ?? ""}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new DiscoveryError("Can't reach the Konnect server. Check your connection.", 0);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; errcode?: string };
  if (!res.ok) {
    const notInstalled = res.status === 404 && data.errcode === "M_UNRECOGNIZED";
    throw new DiscoveryError(
      notInstalled ? "This server doesn't support finding people yet." : data.error ?? "Something went wrong.",
      res.status,
      data.errcode,
    );
  }
  return data as T;
}

export const discovery = {
  settings: (client: MatrixClient) => call<DiscoverySettings>(client, "GET", "settings"),
  update: (client: MatrixClient, changes: { handle_search?: boolean; phone_lookup?: boolean }) =>
    call<{ handle_search: boolean; phone_lookup: boolean }>(client, "PUT", "settings", changes),
  startPhone: (client: MatrixClient, phone: string) => call<{ masked: string; expires_in: number }>(client, "POST", "phone/start", { phone }),
  confirmPhone: (client: MatrixClient, code: string, phoneLookup: boolean) =>
    call<{ masked: string }>(client, "POST", "phone/confirm", { code, phone_lookup: phoneLookup }),
  removePhone: (client: MatrixClient) => call<object>(client, "DELETE", "phone"),
  lookupPhone: (client: MatrixClient, phone: string) =>
    call<{ user_id: string; display_name: string | null }>(client, "POST", "lookup/phone", { phone }),
};

/** "+62 812-3456-7890", "0812 3456 7890" and "6281234567890" all count; handles don't. */
export function looksLikePhone(input: string): boolean {
  const v = input.trim();
  if (!/^\+?[\d\s\-().]+$/.test(v)) return false;
  return v.replace(/\D/g, "").length >= 8;
}

/** "@diemas" for people on your own server, the full ID for anyone else. */
export function shortHandle(userId: string, ownDomain: string | null): string {
  const [local, domain] = userId.split(/:(.+)/);
  return ownDomain && domain === ownDomain ? local : userId;
}
