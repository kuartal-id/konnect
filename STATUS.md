# Konnect — Status

_Last updated: 2026-10-16 (evening) by Claude. Every AI updates this file before finishing (see AGENTS.md)._

## Current stage

**M1 shipped; M1.5 (discovery + server ready for the VPS) in PR #2.** The web app is live at `konnect.kuartalsystems.com` (merged PR #1). Sign-in works once the chat server is running on the VPS.

PR #2 adds: finding people by @handle, name or verified phone number, each with a per-person on/off setting; Konnect-branded handle picker on first sign-in; a server file with nothing to fill in, defaulting to `kuartal.id` IDs and the Kuartal ID client; a setup that applies setting changes on every redeploy. Companion PR in `kuartal-id/kuartal-login` registers the Kuartal ID client.

## Waiting on Diemas

1. "go" on `konnect` PR #2 and the `kuartal-login` Konnect client PR.
2. DNS A record `matrix.kuartalsystems.com` → the VPS IP.
3. Start the server on the VPS (docs/SERVER.md step 3: Docker Manager → deploy from URL, or one line in the browser terminal).
4. Optional, for phone discovery: WhatsApp Cloud API number + `konnect_code` authentication template + token (docs/SERVER.md).

## Next up

- After the server is live: switch the KuartalOS manifest (`kuartal-id/kuartalos` `registry/apps/konnect.json`) from `planned` to `beta`.

- M2: attachments (encrypted upload/download), replies, reactions, edits, read receipts in the UI, notifications outside KuartalOS (Web Push).
- M3: connected apps. Official WhatsApp Business Cloud API and Instagram Messaging API service. mautrix bridges only for internal tests. See docs/ARCHITECTURE.md.
- M4: team CRM (shared, encrypted per workspace), CRM export (CSV), Kuartal AI summaries inside KuartalOS (opt-in, never on encrypted content without consent).
- Mobile apps (iOS/Android) wrapping the web app; store name "Kuartal Konnect", home-screen name "Konnect".

## Known limitations

- Ports 80/443 on the shared VPS belong to Konnect's Caddy. The KuartalOS `api.os` plan must add its site there instead of installing host Caddy (docs/SERVER.md).
- Phone discovery needs the WhatsApp Cloud API set up; until then the app says it isn't switched on.
- Rate limits for phone lookups are kept in memory (reset on server restart). Fine for one Synapse process.

- Messages sent before a device existed can't be read on it unless key backup is set up (normal for end-to-end encryption).
- CRM is one encrypted document per person: last write wins between devices editing at the same moment.
- Media/attachments show as text only.
