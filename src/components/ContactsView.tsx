import { useMemo, useState } from "react";
import { Avatar, Icon } from "./Avatar";
import { LockedCrm } from "./CrmPanel";
import { isDue, STAGES, type Contact, type Stage } from "../lib/crm";
import type { CrmState } from "./Workspace";

type Filter = "all" | "due" | Stage;

/** The whole personal CRM at a glance: every contact, filterable by stage, follow-ups due first. */
export function ContactsView({ crm, onOpen, onUnlock, showBack, onBack }: {
  crm: CrmState;
  onOpen: (c: Contact) => void;
  onUnlock: () => void;
  showBack: boolean;
  onBack: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const contacts = useMemo(() => (crm.status === "unlocked" ? Object.values(crm.data.contacts) : []), [crm]);
  const due = contacts.filter((c) => isDue(c));
  const shown = contacts
    .filter((c) => (filter === "all" ? true : filter === "due" ? isDue(c) : c.stage === filter))
    .filter((c) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return [c.name, c.company, c.note, c.network, ...c.tags].some((v) => v?.toLowerCase().includes(q));
    })
    .sort((a, b) => Number(isDue(b)) - Number(isDue(a)) || (a.followUp ?? "9").localeCompare(b.followUp ?? "9") || b.updatedAt - a.updatedAt);

  return (
    <section className="contacts" aria-label="Contacts">
      <header className="chat-head">
        {showBack && (
          <button className="icon-btn" onClick={onBack} aria-label="Back">
            <Icon name="back" />
          </button>
        )}
        <div className="chat-title">
          <h2>Contacts</h2>
          <p className="muted small">Your private CRM across Konnect, WhatsApp, Instagram and other connected apps</p>
        </div>
      </header>

      {crm.status !== "unlocked" ? (
        <div className="contacts-locked">
          <LockedCrm crm={crm} onUnlock={onUnlock} />
        </div>
      ) : (
        <div className="contacts-body">
          <div className="row wrap">
            <label className="search">
              <Icon name="search" size={16} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, company, tag, note" aria-label="Search contacts" />
            </label>
          </div>
          <div className="chips" role="group" aria-label="Filter">
            {(["all", "due", ...STAGES] as Filter[]).map((f) => (
              <button key={f} className={`chip ${filter === f ? "on" : ""}`} onClick={() => setFilter(f)} aria-pressed={filter === f}>
                {f === "all" ? `All ${contacts.length}` : f === "due" ? `Follow up ${due.length}` : `${f} ${contacts.filter((c) => c.stage === f).length}`}
              </button>
            ))}
          </div>

          {contacts.length === 0 ? (
            <div className="empty">
              <h3>No contacts yet</h3>
              <p className="muted">Open any chat and use the contact panel to add notes, a stage or a follow-up date. They'll show up here.</p>
            </div>
          ) : shown.length === 0 ? (
            <p className="muted pad">Nothing matches.</p>
          ) : (
            <ul className="contact-list">
              {shown.map((c) => (
                <li key={c.key}>
                  <button className="contact-row" onClick={() => onOpen(c)}>
                    <Avatar id={c.key} name={c.name} size={36} />
                    <span className="contact-main">
                      <span className="contact-name">
                        {c.name}
                        {c.company ? <span className="muted"> · {c.company}</span> : null}
                      </span>
                      <span className="muted small ellipsis">{c.note || c.tags.join(", ") || c.key}</span>
                    </span>
                    <span className="contact-side">
                      <span className="stage">{c.stage}</span>
                      {c.followUp && <span className={`small ${isDue(c) ? "due" : "muted"}`}>{isDue(c) ? "Due " : ""}{c.followUp}</span>}
                      {c.network && <span className={`net net-${c.network.toLowerCase()}`}>{c.network}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
