import { useEffect, useRef, useState } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import { VerificationPhase, VerificationRequestEvent, VerifierEvent, type ShowSasCallbacks, type VerificationRequest } from "matrix-js-sdk/lib/crypto-api/index.js";
import { Modal } from "./Dialogs";
import { Icon } from "./Avatar";
import { shortHandle } from "../lib/discovery";

/**
 * Emoji (SAS) verification, for a contact or between your own devices.
 * Both sides see seven emoji; if they match, each side marks the other as verified.
 */
export function VerificationDialog({ client, request, onClose }: { client: MatrixClient; request: VerificationRequest; onClose: () => void }) {
  const [, rerender] = useState(0);
  const [sas, setSas] = useState<ShowSasCallbacks | null>(null);
  const [confirming, setConfirming] = useState(false);
  const started = useRef(false);

  const self = request.isSelfVerification;
  const other = self ? "your other device" : (client.getUser(request.otherUserId)?.displayName ?? shortHandle(request.otherUserId, client.getDomain()));

  useEffect(() => {
    const onChange = () => rerender((n) => n + 1);
    request.on(VerificationRequestEvent.Change, onChange);
    return () => {
      request.off(VerificationRequestEvent.Change, onChange);
    };
  }, [request]);

  // Drive the flow: whoever asked starts the emoji comparison once the other side accepts.
  useEffect(() => {
    const phase = request.phase;
    if (phase === VerificationPhase.Ready && request.initiatedByMe && !started.current) {
      started.current = true;
      void request.startVerification("m.sas.v1").catch(() => undefined);
    }
    const verifier = request.verifier;
    if (verifier && !verifier.hasBeenCancelled) {
      const existing = verifier.getShowSasCallbacks();
      if (existing) setSas(existing);
      const onShow = (s: ShowSasCallbacks) => setSas(s);
      verifier.on(VerifierEvent.ShowSas, onShow);
      void verifier.verify().catch(() => undefined);
      return () => {
        verifier.off(VerifierEvent.ShowSas, onShow);
      };
    }
  }, [request, request.phase, request.verifier]);

  const phase = request.phase;
  const cancel = () => {
    if (phase !== VerificationPhase.Done && phase !== VerificationPhase.Cancelled) void request.cancel().catch(() => undefined);
    onClose();
  };

  let body: JSX.Element;
  if (phase === VerificationPhase.Done) {
    body = (
      <div className="stack verify-done">
        <p className="ok-text">
          <Icon name="shield" /> {self ? "This device is verified." : `${other} is verified.`}
        </p>
        <p className="muted small">
          {self
            ? "Your devices trust each other now."
            : "Konnect will warn you if their security key ever changes. That could mean someone else is trying to read your messages."}
        </p>
        <button className="btn primary" onClick={onClose}>Done</button>
      </div>
    );
  } else if (phase === VerificationPhase.Cancelled) {
    body = (
      <div className="stack">
        <p>Verification stopped{request.cancellationCode === "m.mismatched_sas" ? " because the emoji didn't match" : ""}.</p>
        {request.cancellationCode === "m.mismatched_sas" && (
          <p className="alert small">If you were comparing in person, someone may be interfering. Don't share anything sensitive until you've verified again.</p>
        )}
        <button className="btn" onClick={onClose}>Close</button>
      </div>
    );
  } else if (sas?.sas.emoji) {
    body = (
      <div className="stack">
        <p>Compare these with {other}. Do it in person or on a call, not over chat.</p>
        <ol className="sas-grid" aria-label="Verification emoji">
          {sas.sas.emoji.map(([emoji, name]) => (
            <li key={name}>
              <span className="sas-emoji" aria-hidden="true">{emoji}</span>
              <span className="small">{name}</span>
            </li>
          ))}
        </ol>
        {confirming ? (
          <p className="muted small">Waiting for {other} to confirm…</p>
        ) : (
          <div className="row wrap">
            <button
              className="btn primary"
              onClick={() => {
                setConfirming(true);
                void sas.confirm();
              }}
            >
              They match
            </button>
            <button className="btn" onClick={() => sas.mismatch()}>They don't match</button>
          </div>
        )}
      </div>
    );
  } else if (phase === VerificationPhase.Requested && !request.initiatedByMe) {
    body = (
      <div className="stack">
        <p>{self ? "Another device of yours wants to verify this one." : `${other} wants to verify you.`}</p>
        <p className="muted small">You'll both compare seven emoji. It takes about a minute.</p>
        <div className="row">
          <button className="btn primary" onClick={() => void request.accept()}>Start</button>
          <button className="btn" onClick={cancel}>Not now</button>
        </div>
      </div>
    );
  } else {
    body = (
      <div className="stack">
        <p>{phase === VerificationPhase.Requested ? (self ? "Open Konnect on your other device and accept the request." : `Waiting for ${other} to accept…`) : "Connecting…"}</p>
        <button className="btn" onClick={cancel}>Cancel</button>
      </div>
    );
  }

  return (
    <Modal title={self ? "Verify this device" : `Verify ${other}`} onClose={cancel}>
      {body}
    </Modal>
  );
}
