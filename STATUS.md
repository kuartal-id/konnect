# Konnect — Status

_Last updated: 2026-10-16 by Claude. Every AI updates this file before finishing (see AGENTS.md)._

## Current stage

**M1 — Web app MVP (PR #1, waiting for Diemas's "go").** Encrypted DMs, groups, workspaces, recovery key, encrypted personal CRM, Kuartal ID sign-in, KuartalOS bridge. Tested end to end against a local Synapse. Not deployed: the chat server doesn't exist yet.

## Waiting on Diemas

1. **Konnect ID domain** (`SERVER_NAME`, permanent): recommended `kuartal.id` → IDs like `@diemas:kuartal.id`.
2. **Chat server**: create a Hostinger VPS and deploy `server/docker-compose.yml` (docs/SERVER.md).
3. **Kuartal ID client** for Konnect (public, PKCE, redirect `https://matrix.kuartalsystems.com/_synapse/client/oidc/callback`), registered server-side in `kuartal-id/kuartal-login`.
4. Add `konnect.kuartalsystems.com` in hPanel → Git → branch `deploy`. Set GitHub repo variable `HOMESERVER_URL`.

## Next up

- M2: attachments (encrypted upload/download), replies, reactions, edits, read receipts in the UI, notifications outside KuartalOS (Web Push).
- M3: connected apps. Official WhatsApp Business Cloud API and Instagram Messaging API service. mautrix bridges only for internal tests. See docs/ARCHITECTURE.md.
- M4: team CRM (shared, encrypted per workspace), CRM export (CSV), Kuartal AI summaries inside KuartalOS (opt-in, never on encrypted content without consent).
- Mobile apps (iOS/Android) wrapping the web app; store name "Kuartal Konnect", home-screen name "Konnect".

## Known limitations

- Messages sent before a device existed can't be read on it unless key backup is set up (normal for end-to-end encryption).
- CRM is one encrypted document per person: last write wins between devices editing at the same moment.
- Media/attachments show as text only.
