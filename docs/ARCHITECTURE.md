# Konnect architecture

Konnect is Kuartal's messaging app: encrypted 1:1 and group chats, team workspaces, and a private CRM for each person. Later it also becomes one inbox for WhatsApp, Instagram and other apps. It is a web app first, and opens as an app inside KuartalOS.

```
 Browser / KuartalOS window                         Hostinger VPS (Docker)
┌──────────────────────────────┐   HTTPS   ┌───────────────────────────────────────────┐
│ Konnect web app (this repo)  │◄─────────►│ Caddy ─► Synapse (Matrix server) ─► Postgres│
│  • matrix-js-sdk (Apache-2.0)│           │            ▲                                │
│  • Rust crypto (WASM)        │           │            │ later: bridges                 │
│  • CRM, encrypted in-browser │           │   WhatsApp Business API, Instagram API ...  │
└──────────────┬───────────────┘           └────────────┬──────────────────────────────┘
               │ sign in (OIDC, PKCE)                    │
               └──────────────► Kuartal ID (id.kuartal.id) ◄┘
```

## Why Matrix

- Open protocol with proven end-to-end encryption (Olm/Megolm, Signal-style). We don't invent cryptography.
- Spaces give Slack- or Discord-style workspaces. Bridges give WhatsApp, Instagram, Telegram and others.
- **Licences:** the client SDK (`matrix-js-sdk`) and the crypto engine are Apache-2.0, so this app is fully Kuartal's. The server (Synapse) is AGPL. We run it unmodified, so the only obligation is to share source if we ever change Synapse itself. We don't fork Element (AGPL).

## Accounts and sign-in

- Kuartal ID is an OIDC provider. Synapse trusts it as `oidc-kuartal`, using the public client `14d2db71-041a-4841-aca5-3218ff8b0023` (PKCE, no secret), registered by a `kuartal-login` migration. Synapse reads name and email from `/oauth/userinfo` and links accounts by `sub`. It doesn't store the email.
- Flow: Konnect → `matrix/_matrix/client/v3/login/sso/redirect/oidc-kuartal` → Kuartal ID login (including its 2FA) → Synapse → back to Konnect with a one-time `loginToken` → Konnect exchanges it for an access token.
- Inside a KuartalOS window, sign-in opens in a new tab. Konnect and KuartalOS are the same site (`*.kuartalsystems.com`), so the session saved by that tab is picked up by the window through a `storage` event.
- Password sign-in exists only for admin and test accounts. Open registration is off.

## Encryption

- Every chat Konnect creates is end-to-end encrypted (`m.megolm.v1.aes-sha2`). The server also enforces this by default for every room type.
- **Recovery key** (`src/lib/matrix.ts`): the first time, Konnect creates the cross-signing identity, secret storage and an encrypted key backup, and shows a 48-character recovery key once. On a new device, the person enters it to trust that device and restore older messages.
- Safety rule: Konnect asks for the recovery key **before** calling cross-signing setup on a device that already has an identity. A cancelled prompt can never create a new identity and lock the person out of their own history.
- Message keys live in the browser's IndexedDB (Rust crypto store). Signing out deletes them, along with the session on the server.

## Finding people (`server/modules/konnect_discovery.py`, `src/lib/discovery.ts`)

Each person controls how they can be found (Settings → How people find you):

| Way to find someone | Default | Control |
| --- | --- | --- |
| Search by name or @handle | On | "Show me in search". When off, the server's user-directory filter leaves them out of everyone else's results. |
| Exact @handle | Always | Same as knowing an email address: whoever types the full handle can start a chat. |
| Phone number | Off until verified | Add one number, prove it with a 6-digit WhatsApp code, then choose "Let people who have my number find me". |

- **Handles** are the Matrix localpart, chosen once at first Kuartal ID sign-in on a branded Synapse page (`server/templates/`). IDs are `@handle:kuartal.id`; the app shows `@handle`.
- **Phone privacy**: the server stores only `HMAC-SHA256(server pepper, E.164 number)` and a masked form. A database dump can't be turned back into numbers without the pepper, which is created on the server and kept in `/data/konnect-secrets.json`. "Not found" and "found but switched off" give the same answer. Lookups need sign-in and are rate-limited (30/hour, 100/day per person). Code requests are limited to 3/hour per person and per number.
- **Recycled numbers**: whoever verifies a number most recently owns it; the previous owner loses it.
- Numbers are normalized with `phonenumbers` (Synapse already depends on it). Indonesian local formats (`0812…`, `62812…`) work.
- API: `GET/PUT settings`, `POST phone/start`, `POST phone/confirm`, `DELETE phone`, `POST lookup/phone` under `/_synapse/client/konnect/v1/`, with a Matrix access token.

## Personal CRM (`src/lib/crm.ts`)

- One document per person: contacts keyed by Matrix user ID (works for bridged WhatsApp/Instagram people too) or room ID for groups. Each contact has stage, company, tags, notes and a follow-up date.
- Encrypted in the browser with **AES-256-GCM**, and stored as the account-data event `id.kuartal.konnect.crm.v1`. The server only sees `{v, iv, data}`. The end-to-end test checks this.
- The AES key is random. It is stored in secret storage (locked by the recovery key) as `id.kuartal.konnect.crm_key.v1`, and cached per device as a **non-extractable** WebCrypto key in IndexedDB. So the recovery key is needed once per device.
- **Limits:** one document per person, so last write wins if two devices edit at the same moment. Fine for one person's CRM. Account data has a size ceiling, enough for a few thousand contacts. Team or shared CRM is a later feature (a separate encrypted room per team).

## Connected apps (WhatsApp, Instagram, …) — not built yet

Matrix bridges turn a WhatsApp or Instagram conversation into a Matrix room, marked with an `m.bridge` state event. **Konnect already reads that marker**: such chats show a network badge, and their people can have CRM entries like anyone else (`roomNetwork()` in `src/lib/rooms.ts`).

Two ways to connect, with different risk:

| Route | What it is | Use for |
| --- | --- | --- |
| **Official APIs**: WhatsApp Business Platform (Cloud API), Instagram Messaging API | Meta-approved, business accounts only. WhatsApp charges per conversation. | **Production.** A small Konnect service that maps each business number or account to Matrix rooms. |
| **Unofficial bridges**: mautrix-whatsapp, mautrix-meta | Log in as a personal account like WhatsApp Web. | Internal testing only. Against Meta's terms, and accounts can be banned. |

Bridged messages are decrypted on our server to relay them, so they are **not end-to-end encrypted** inside Konnect. The chat header says so ("Bridged · not end-to-end encrypted in Konnect").

## KuartalOS

- Manifest: `registry/apps/konnect.json` in `kuartal-id/kuartalos` (`kind: web`, `url: https://konnect.kuartalsystems.com`, permission `notify`).
- `src/lib/kuartalos.ts` is a copy of the KuartalOS SDK protocol v1. It sets the window title (with the unread count) and sends new-message notifications. Keep the message shapes identical to `packages/sdk/src/protocol.ts`.
- `public/.htaccess` sends `Content-Security-Policy: frame-ancestors 'self' https://os.kuartalsystems.com https://os.kuartal.id`.

## Code map

| File | What it does |
| --- | --- |
| `src/App.tsx` | Start-up: resume session, finish Kuartal ID redirect, sign out |
| `src/lib/matrix.ts` | Create the client, recovery key setup and unlock |
| `src/lib/rooms.ts` | Chat list, DMs, groups, workspaces, network badges |
| `src/lib/crm.ts` | Encrypted CRM storage |
| `src/lib/kuartalos.ts` | KuartalOS SDK bridge |
| `src/components/Workspace.tsx` | Main layout and state |
| `src/components/ChatView.tsx` | Timeline and composer |
| `src/components/CrmPanel.tsx`, `ContactsView.tsx` | CRM screens |
| `src/components/Dialogs.tsx` | New chat, invite, recovery, settings |
| `src/lib/discovery.ts` | Finding people by handle/phone, discovery settings |
| `server/docker-compose.yml` | Chat server for the VPS, **generated** by `server/build_compose.py` from the template plus `setup.py`, `modules/` and `templates/` |
| `server/modules/konnect_discovery.py` | Synapse module: search visibility, verified phones, lookup |
