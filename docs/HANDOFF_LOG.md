# Handoff log

Newest first. Every AI adds an entry before finishing.

## 2026-10-17 (night) — Claude — `claude/4-everyday-features`

**Did:** Everything needed for Kuartal ID users to use Konnect day to day:
- Encrypted files and photos (`src/lib/attachments.ts`): AES-256-CTR per the spec, authenticated media download, hash check, only safe image types inline; paperclip, drag and drop, paste.
- Reply, edit (own text, ArrowUp edits last), delete (own, confirmed), reactions (`src/lib/messages.ts`, actions on hover or tap).
- Verification (`src/components/Verification.tsx`, `src/lib/trust.ts`): emoji with contacts (DM request) and own devices; incoming requests open automatically; verified shield; identity-change banner with Verify / I understand.
- Chat info (`src/components/ChatInfo.tsx`): members with trust, rename, invite, leave, block. Settings: devices list with verified state, blocked people, notifications (off / show / hide text). Invites can be declined and blocked.
- First-run setup (`src/components/Onboarding.tsx`): name, how people find you, notifications, then recovery key. The done flag (`id.kuartal.konnect.onboarding`) is read straight from the server, because a local-cache race showed it again in testing.
- Installable app: `manifest.webmanifest`, PNG and maskable icons, apple-touch-icon; app badge for unread.
- Fixes: chat-list preview of verification requests and edits; contact panel no longer covers phone screens.

**Tested:** New two-browser suite, 13/13: onboarding, DM, reply, edit, reaction, encrypted photo shown, file downloaded byte-for-byte, server sees only `m.room.encrypted`, delete, contact emoji verification (both saw identical emoji), second device verified from the first and reads history, block. Discovery suite 7/7, core suite 13/13 (onboarding-aware), typecheck and build.

**Not done / known issues:** Push when closed, remote sign-out of other devices, calls, message search (see STATUS "Next up"). Notifications on iOS need the app installed to the home screen (iOS 16.4+).

**Next AI should:** After merge, sanity-check on production: send a photo between two real accounts and do one emoji verification.

## 2026-10-17 — Claude — `claude/3-shared-caddy`

**Did:** Deployed the chat server on the Kuartal VPS with Diemas. `docker compose up` started setup, Postgres and Synapse healthy, but Konnect's Caddy couldn't bind :80, because the VPS already runs host Caddy (KuartalOS `api.os` pilot). Fix applied on the VPS: `docker-compose.override.yml` (Konnect Caddy behind a profile, Synapse on `127.0.0.1:8008`) plus `/etc/caddy/konnect.caddy` imported from the host Caddyfile, validated before reload. Verified from outside: HTTPS works, and `/_matrix/client/v3/login` offers `oidc-kuartal` (Kuartal ID). This PR records both files in `server/shared-proxy/` and documents the setup and update command.

**Not done / known issues:** First real Kuartal ID sign-in pending (Diemas). WhatsApp codes not configured.

**Next AI should:** Don't install another web server on 80/443 on this VPS. Add sites to `/etc/caddy/` with `import` like Konnect does.

## 2026-10-16 (evening) — Claude — `claude/2-discovery`

**Did:** Diemas asked to find people by @handle or phone number, with each person choosing how they're found, and to run the server on the VPS that already hosts Kuartal AI. He delegated the remaining decisions:
- `SERVER_NAME=kuartal.id`, server at `matrix.kuartalsystems.com`, Kuartal ID public client `14d2db71-…0023` (kuartal-login PR registers it by migration). All of these are defaults, so the compose file needs no values.
- `server/modules/konnect_discovery.py` (Synapse module): user-directory filter for "Show me in search"; one verified phone per person (WhatsApp Cloud API authentication template, or a test-only log verifier); HMAC-peppered storage plus masked display; lookup with rate limits; recycled numbers move to the latest verifier.
- `server/setup.py`: secrets created once in `/data/konnect-secrets.json`, `homeserver.yaml` regenerated every start, `SERVER_NAME` locked after first use, WhatsApp switched on by env vars.
- Branded Synapse templates (`server/templates/`) for the first-sign-in handle picker; no Matrix logos or external images.
- `server/build_compose.py` embeds setup, module and templates into the one-file `server/docker-compose.yml`; CI checks it's current.
- App: New chat finds people by name, exact @handle (even if hidden from search) or phone; Settings → "How people find you"; short `@handle` display; profile name loads correctly.

**Tested:** Module API test (26 checks: auth, CORS, search hiding, exact handle, phone formats, wrong/expired codes, hashed storage, lookup on/off, rate limits, recycled number, remove). WhatsApp request format against a fake Graph endpoint. Kuartal ID → Synapse → Konnect sign-in end to end against a local Kuartal ID (PHP 8.4) with the production OIDC settings, including the branded handle page and returning-user sign-in. Browser test with two people (verify phone, hide from search, find by handle and by phone, phone lookup off). Full M1 regression (13/13). `docker compose config` on the generated file. Setup script run locally: config validated by Synapse's own loader, secrets 0600, SERVER_NAME lock.

**Not done / known issues:** Not run on the real VPS (no Docker daemon here). WhatsApp codes untested against real Meta (needs his WhatsApp Business setup). Lookup rate limits are in memory. OIDC back-channel logout not enabled (Kuartal ID ID tokens have no `sid`, which Synapse needs).

**Next AI should:** After Diemas deploys, check `https://matrix.kuartalsystems.com`, sign in via Kuartal ID on konnect.kuartalsystems.com, then flip the KuartalOS manifest to `beta`.

## 2026-10-16 — Claude — `claude/1-web-app-mvp`

**Did:** Built the Konnect web app from an empty repo: React + Vite + TypeScript on `matrix-js-sdk` 44 with Rust crypto. Sign-in with password or Kuartal ID (OIDC via Synapse SSO, including the KuartalOS new-tab flow). Chat list with invites, DMs, encrypted groups, workspaces (Matrix spaces), timeline with load-earlier, typing, read receipts, composer. Recovery key setup and new-device restore. Personal CRM encrypted in the browser (AES-GCM, key in secret storage, cached non-extractable per device) with a contact panel and Contacts view. Network badges for bridged rooms. KuartalOS SDK bridge (title, notify) and `.htaccess` with `frame-ancestors`. `server/docker-compose.yml` for a Hostinger VPS that generates its own secrets. Docs, CI, deploy-to-`deploy`-branch workflow.

**Fixed during testing:** sign-out now waits until every message key is in the encrypted backup (`waitForKeyBackup`). Before that, about 1 in 4 "sign out, sign in on a new device" runs lost the newest message, because the crypto engine starts backing up keys after a random delay of up to 10 s. If the backup can't finish, the person is warned and can choose "Sign out anyway".

**Tested:** Playwright against a local Synapse 1.163 with two users: login, recovery key, encrypted DM both directions, CRM save (verified the server only stores ciphertext), Contacts due filter, workspace + encrypted group, sign out → sign in as a new device → recovery key restores history and CRM, phone-width layout. Last 4 consecutive runs: 13/13 steps each. Kuartal ID button redirects to `id.kuartal.id/oauth/authorize` with PKCE S256. The generated server config passes Synapse's validator.

**Not done / known issues:** No real server or Kuartal ID client yet (see STATUS "Waiting on Diemas"). Attachments, replies, reactions, edits, push notifications, WhatsApp/Instagram connections. The compose file is validated but not yet run on a real VPS. Bundle includes the 7.8 MB crypto WASM (cached forever by `.htaccess`).

**Next AI should:** Review this PR (a different AI than Claude). After the server exists, run the full flow on production with Kuartal ID. Then start M2 with encrypted attachments.
