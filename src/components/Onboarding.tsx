import { useEffect, useState } from "react";
import { Method, type MatrixClient, type MatrixEvent } from "matrix-js-sdk";
import { FindMeSettings, Modal } from "./Dialogs";
import { Icon } from "./Avatar";
import { shortHandle } from "../lib/discovery";
import { getNotifyPref, notificationsSupported, setNotifyPref } from "../lib/notify";

export const ONBOARDING_TYPE = "id.kuartal.konnect.onboarding";

/** Asks the server directly (not the local cache), so a finished setup is never shown again. */
export async function needsOnboarding(client: MatrixClient): Promise<boolean> {
  const local = client.getAccountData(ONBOARDING_TYPE as never)?.getContent() as { done?: boolean } | undefined;
  if (local?.done) return false;
  try {
    const path = `/user/${encodeURIComponent(client.getSafeUserId())}/account_data/${encodeURIComponent(ONBOARDING_TYPE)}`;
    const remote = await client.http.authedRequest<{ done?: boolean }>(Method.Get, path);
    return !remote?.done;
  } catch (e) {
    // Only "not found" means the person never finished; on any other error, don't nag.
    return (e as { errcode?: string }).errcode === "M_NOT_FOUND";
  }
}

export function isOnboardingDone(ev: MatrixEvent): boolean {
  return ev.getType() === ONBOARDING_TYPE && Boolean((ev.getContent() as { done?: boolean }).done);
}

/**
 * First-run setup for someone who just signed in with Kuartal ID: their name, how people find them,
 * notifications. The recovery key comes right after (it has its own screen).
 */
export function Onboarding({ client, embedded, onDone }: { client: MatrixClient; embedded: boolean; onDone: () => void }) {
  const userId = client.getSafeUserId();
  const handle = shortHandle(userId, client.getDomain());
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [notify, setNotify] = useState(getNotifyPref() !== "off");
  const steps = embedded || !notificationsSupported() ? 2 : 3;

  useEffect(() => {
    client.getProfileInfo(userId).then(
      (p) => setName((n) => n || p.displayname || ""),
      () => undefined,
    );
  }, [client, userId]);

  async function finish() {
    setBusy(true);
    await client.setAccountData(ONBOARDING_TYPE as never, { done: true, v: 1 } as never).catch(() => undefined);
    onDone();
  }

  return (
    <Modal title={`Welcome to Konnect · ${step + 1} of ${steps}`}>
      {step === 0 && (
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            if (name.trim()) await client.setDisplayName(name.trim()).catch(() => undefined);
            setBusy(false);
            setStep(1);
          }}
        >
          <p>
            Your handle is <strong>{handle}</strong>. People can message you with it.
          </p>
          <label>
            Your name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="How people see you" autoFocus />
          </label>
          <p className="muted small">
            <Icon name="lock" size={12} /> Every chat you start in Konnect is end-to-end encrypted. Kuartal can't read your messages or your CRM notes.
          </p>
          <button className="btn primary" disabled={busy}>Continue</button>
        </form>
      )}
      {step === 1 && (
        <div className="stack">
          <div className="settings onboarding-find">
            <FindMeSettings client={client} />
          </div>
          <div className="row">
            <button className="btn primary" onClick={() => (steps === 3 ? setStep(2) : void finish())} disabled={busy}>
              Continue
            </button>
            <button className="btn ghost" onClick={() => setStep(0)}>Back</button>
          </div>
        </div>
      )}
      {step === 2 && (
        <div className="stack">
          <p>
            <strong>Get notified about new messages?</strong>
          </p>
          <p className="muted small">Notifications work while Konnect is open, also in a background tab or as an installed app. You can change this in Settings.</p>
          <label className="switch-row">
            <span>Notify me on this device</span>
            <input
              type="checkbox"
              role="switch"
              checked={notify}
              onChange={async (e) => {
                const result = await setNotifyPref(e.target.checked ? "full" : "off");
                setNotify(result !== "off");
              }}
            />
          </label>
          <div className="row">
            <button className="btn primary" onClick={() => void finish()} disabled={busy}>
              Continue
            </button>
            <button className="btn ghost" onClick={() => setStep(1)}>Back</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
