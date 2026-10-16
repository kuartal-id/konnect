# Konnect — Status

_Last updated: 2026-10-17 by Claude. Every AI updates this file before finishing (see AGENTS.md)._

## Current stage

**Live.** Web app at `konnect.kuartalsystems.com`; chat server at `matrix.kuartalsystems.com` on the Kuartal VPS since 2026-10-17, behind the VPS's existing host Caddy (docs/SERVER.md). Sign in with Kuartal ID, @handles, discovery and encryption are on. Phone discovery waits for WhatsApp Cloud API details.

## Waiting on Diemas

1. First real sign-in and choosing his handle.
2. Optional: WhatsApp Cloud API number, `konnect_code` template and token for phone verification (docs/SERVER.md).

## Next up

- After the server is live: switch the KuartalOS manifest (`kuartal-id/kuartalos` `registry/apps/konnect.json`) from `planned` to `beta`.

- M2: attachments (encrypted upload/download), replies, reactions, edits, read receipts in the UI, notifications outside KuartalOS (Web Push).
- M3: connected apps. Official WhatsApp Business Cloud API and Instagram Messaging API service. mautrix bridges only for internal tests. See docs/ARCHITECTURE.md.
- M4: team CRM (shared, encrypted per workspace), CRM export (CSV), Kuartal AI summaries inside KuartalOS (opt-in, never on encrypted content without consent).
- Mobile apps (iOS/Android) wrapping the web app; store name "Kuartal Konnect", home-screen name "Konnect".

## Known limitations

- Phone discovery needs the WhatsApp Cloud API set up; until then the app says it isn't switched on.
- Rate limits for phone lookups are kept in memory (reset on server restart). Fine for one Synapse process.

- Messages sent before a device existed can't be read on it unless key backup is set up (normal for end-to-end encryption).
- CRM is one encrypted document per person: last write wins between devices editing at the same moment.
- Media/attachments show as text only.
