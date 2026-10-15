import { useEffect, useRef, useState } from "react";
import { Icon } from "./Avatar";
import { newContact, STAGES, type Contact, type Stage } from "../lib/crm";
import type { CrmState } from "./Workspace";

interface Props {
  crm: CrmState;
  isGroup: boolean;
  contactKey: string;
  defaultName: string;
  network?: string;
  onSave: (c: Contact) => void;
  onUnlock: () => void;
  onClose: () => void;
}

export function CrmPanel({ crm, isGroup, contactKey, defaultName, network, onSave, onUnlock, onClose }: Props) {
  return (
    <aside className="crm" aria-label="Contact details">
      <header className="crm-head">
        <h3>{isGroup ? "Group" : "Contact"}</h3>
        <button className="icon-btn" onClick={onClose} aria-label="Close contact details">
          <Icon name="close" />
        </button>
      </header>
      {crm.status === "unlocked" ? (
        <ContactForm
          key={contactKey}
          initial={crm.data.contacts[contactKey] ?? newContact(contactKey, defaultName, network)}
          saved={Boolean(crm.data.contacts[contactKey])}
          saving={crm.saving}
          onSave={onSave}
        />
      ) : (
        <LockedCrm crm={crm} onUnlock={onUnlock} />
      )}
    </aside>
  );
}

export function LockedCrm({ crm, onUnlock }: { crm: CrmState; onUnlock: () => void }) {
  if (crm.status === "loading") return <p className="muted pad">Loading…</p>;
  return (
    <div className="pad stack">
      <p className="lock-title">
        <Icon name="lock" size={16} /> Your CRM is encrypted
      </p>
      <p className="muted small">
        Notes, tags and deal stages are encrypted with your recovery key before they leave this device. Only you can read them.
      </p>
      {crm.status === "error" && <p className="alert small">{crm.error}</p>}
      <button className="btn primary" onClick={onUnlock}>
        {crm.status === "no-recovery" ? "Set up recovery key" : "Unlock with recovery key"}
      </button>
    </div>
  );
}

function ContactForm({ initial, saved, saving, onSave }: { initial: Contact; saved: boolean; saving: boolean; onSave: (c: Contact) => void }) {
  const [c, setC] = useState<Contact>(initial);
  const [tagInput, setTagInput] = useState("");
  const [dirty, setDirty] = useState(false);

  // Autosave a moment after the last change.
  useEffect(() => {
    if (!dirty) return;
    const t = window.setTimeout(() => {
      onSave({ ...c, updatedAt: Date.now() });
      setDirty(false);
    }, 700);
    return () => window.clearTimeout(t);
  }, [c, dirty, onSave]);

  // If the person switches chats before autosave fires, save on the way out.
  const latest = useRef({ c, dirty, onSave });
  latest.current = { c, dirty, onSave };
  useEffect(
    () => () => {
      const { c: last, dirty: wasDirty, onSave: save } = latest.current;
      if (wasDirty) save({ ...last, updatedAt: Date.now() });
    },
    [],
  );

  const update = (patch: Partial<Contact>) => {
    setC((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  };

  function addTag() {
    const tag = tagInput.trim().replace(/,$/, "");
    if (tag && !c.tags.includes(tag)) update({ tags: [...c.tags, tag] });
    setTagInput("");
  }

  return (
    <div className="pad stack crm-form">
      <label>
        Name
        <input value={c.name} onChange={(e) => update({ name: e.target.value })} />
      </label>
      <label>
        Company
        <input value={c.company ?? ""} onChange={(e) => update({ company: e.target.value })} placeholder="Optional" />
      </label>
      {c.network && <p className="muted small">From {c.network}</p>}

      <fieldset className="stages">
        <legend>Stage</legend>
        <div className="chips">
          {STAGES.map((s: Stage) => (
            <button key={s} type="button" className={`chip ${c.stage === s ? "on" : ""}`} onClick={() => update({ stage: s })} aria-pressed={c.stage === s}>
              {s}
            </button>
          ))}
        </div>
      </fieldset>

      <label>
        Follow up on
        <input type="date" value={c.followUp ?? ""} onChange={(e) => update({ followUp: e.target.value || undefined })} />
      </label>

      <div>
        <span className="label">Tags</span>
        <div className="chips">
          {c.tags.map((t) => (
            <span key={t} className="chip on">
              {t}
              <button type="button" className="chip-x" aria-label={`Remove tag ${t}`} onClick={() => update({ tags: c.tags.filter((x) => x !== t) })}>
                ×
              </button>
            </span>
          ))}
          <input
            className="tag-input"
            value={tagInput}
            placeholder="Add tag"
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addTag();
              }
            }}
            onBlur={addTag}
          />
        </div>
      </div>

      <label>
        Notes
        <textarea rows={7} value={c.note} onChange={(e) => update({ note: e.target.value })} placeholder="What do you need to remember about them?" />
      </label>

      <p className="muted small save-state">
        <Icon name="lock" size={12} /> {dirty || saving ? "Saving…" : saved ? "Saved, encrypted" : "Not saved yet. Start typing to add this contact."}
      </p>
    </div>
  );
}
