# Konnect

**Kuartal Konnect** is Kuartal's encrypted messaging app. It has direct messages, group chats and team workspaces, plus a private CRM for every person. It's built on the open Matrix protocol, signs in with Kuartal ID, and opens as an app inside KuartalOS.

- Web app: `konnect.kuartalsystems.com` (planned)
- Chat server: `matrix.kuartalsystems.com` (planned)
- Store listing name **Kuartal Konnect**; home-screen name **Konnect**

## What works today

- Sign in with Kuartal ID (single sign-on), or with a password for admin/test accounts
- 1:1 and group chats, **end-to-end encrypted** by default
- Workspaces (like Slack workspaces or Discord servers) holding group chats
- Invites: accept or decline; invite people to groups
- Recovery key: back up encryption, then restore history on a new device
- **Personal CRM** next to every chat (stage, company, tags, notes, follow-up date), encrypted in the browser so the server can't read it, plus a Contacts view with follow-ups due
- Network badges for chats bridged from WhatsApp, Instagram, Telegram and others
- KuartalOS: window title with unread count, new-message notifications
- Light and dark theme, phone-width layout

Not yet: attachments, replies/reactions, voice/video, WhatsApp/Instagram connections, team CRM. See [STATUS.md](STATUS.md).

## Run it locally

```sh
npm install
VITE_HOMESERVER_URL=https://your-matrix-server npm run dev
```

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how it fits together, encryption and CRM privacy model, connected-apps plan
- [docs/SERVER.md](docs/SERVER.md): set up the chat server on a Hostinger VPS, no terminal
- [AGENTS.md](AGENTS.md): rules for AI contributors
