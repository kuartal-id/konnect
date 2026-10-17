# Konnect — Status

_Last updated: 2026-10-18 by Claude. Every AI updates this file before finishing (see AGENTS.md)._

## Current stage

**Live.** Web app at `konnect.kuartalsystems.com`, chat server at `matrix.kuartalsystems.com` on the Kuartal VPS behind host Caddy (docs/SERVER.md). Diemas signed in with Kuartal ID on 2026-10-17.

**M2 (everyday features) merged (#4):** encrypted files and photos; reply, edit, delete, reactions; emoji verification with contacts and between own devices, plus identity-change warnings; chat info (members, rename, leave, block); browser notifications; first-run setup; installable app (manifest and icons).

## Waiting on Diemas

1. "go" on the sign-in fix PR (`claude/5-signin-store-fix`): a new sign-in in a browser that still held an old session's encryption store failed with "the account in the store doesn't match".
2. Optional: WhatsApp Cloud API number, `konnect_code` template and token for phone verification (docs/SERVER.md).

## Next up

- Push notifications when Konnect is closed: needs a push gateway (Sygnal) on the VPS, a service worker, and VAPID keys made on the server.
- Sign out other devices from Settings: needs the Kuartal ID re-authentication step (SSO fallback page) that the server asks for.
- Voice/video calls (Element Call / LiveKit on the VPS).

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
