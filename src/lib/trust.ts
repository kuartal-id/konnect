/** Whether we've verified someone, and whether their security key changed since. */
import { useEffect, useState } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import { CryptoEvent } from "matrix-js-sdk/lib/crypto-api/index.js";

export type Trust = "verified" | "unverified" | "changed" | "unknown";

export async function getTrust(client: MatrixClient, userId: string): Promise<Trust> {
  const crypto = client.getCrypto();
  if (!crypto) return "unknown";
  try {
    const s = await crypto.getUserVerificationStatus(userId);
    if (s.isCrossSigningVerified()) return "verified";
    if (s.needsUserApproval || s.wasCrossSigningVerified()) return "changed";
    return "unverified";
  } catch {
    return "unknown";
  }
}

export function useTrust(client: MatrixClient, userId: string | null): Trust {
  const [trust, setTrust] = useState<Trust>("unknown");
  useEffect(() => {
    if (!userId) return;
    let live = true;
    const refresh = () => void getTrust(client, userId).then((t) => live && setTrust(t));
    refresh();
    const onChange = (changedUser: string) => {
      if (changedUser === userId) refresh();
    };
    client.on(CryptoEvent.UserTrustStatusChanged, onChange);
    client.on(CryptoEvent.KeysChanged, refresh);
    return () => {
      live = false;
      client.off(CryptoEvent.UserTrustStatusChanged, onChange);
      client.off(CryptoEvent.KeysChanged, refresh);
    };
  }, [client, userId]);
  return trust;
}

/** "I understand": accept someone's new security key without verifying (removes the warning). */
export async function acceptNewIdentity(client: MatrixClient, userId: string): Promise<void> {
  const crypto = client.getCrypto();
  if (!crypto) return;
  const s = await crypto.getUserVerificationStatus(userId);
  if (s.wasCrossSigningVerified() && !s.isCrossSigningVerified()) await crypto.withdrawVerificationRequirement(userId);
  else await crypto.pinCurrentUserIdentity(userId);
}
