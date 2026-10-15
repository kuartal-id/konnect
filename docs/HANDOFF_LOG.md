# Handoff log

Newest first. Every AI adds an entry before finishing.

## 2026-10-16 — Claude — `claude/1-web-app-mvp`

**Did:** Built the Konnect web app from an empty repo: React + Vite + TypeScript on `matrix-js-sdk` 44 with Rust crypto. Sign-in with password or Kuartal ID (OIDC via Synapse SSO, including the KuartalOS new-tab flow). Chat list with invites, DMs, encrypted groups, workspaces (Matrix spaces), timeline with load-earlier, typing, read receipts, composer. Recovery key setup and new-device restore. Personal CRM encrypted in the browser (AES-GCM, key in secret storage, cached non-extractable per device) with a contact panel and Contacts view. Network badges for bridged rooms. KuartalOS SDK bridge (title, notify) and `.htaccess` with `frame-ancestors`. `server/docker-compose.yml` for a Hostinger VPS that generates its own secrets. Docs, CI, deploy-to-`deploy`-branch workflow.

**Fixed during testing:** sign-out now waits until every message key is in the encrypted backup (`waitForKeyBackup`). Before that, about 1 in 4 "sign out, sign in on a new device" runs lost the newest message, because the crypto engine starts backing up keys after a random delay of up to 10 s. If the backup can't finish, the person is warned and can choose "Sign out anyway".

**Tested:** Playwright against a local Synapse 1.163 with two users: login, recovery key, encrypted DM both directions, CRM save (verified the server only stores ciphertext), Contacts due filter, workspace + encrypted group, sign out → sign in as a new device → recovery key restores history and CRM, phone-width layout. Last 4 consecutive runs: 13/13 steps each. Kuartal ID button redirects to `id.kuartal.id/oauth/authorize` with PKCE S256. The generated server config passes Synapse's validator.

**Not done / known issues:** No real server or Kuartal ID client yet (see STATUS "Waiting on Diemas"). Attachments, replies, reactions, edits, push notifications, WhatsApp/Instagram connections. The compose file is validated but not yet run on a real VPS. Bundle includes the 7.8 MB crypto WASM (cached forever by `.htaccess`).

**Next AI should:** Review this PR (a different AI than Claude). After the server exists, run the full flow on production with Kuartal ID. Then start M2 with encrypted attachments.
