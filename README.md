# Konnect

**Kuartal Konnect** is Kuartal's encrypted messaging app. It has direct messages, group chats and team workspaces, plus a private CRM for every person. It's built on the open Matrix protocol, signs in with Kuartal ID, and opens as an app inside KuartalOS.

- Web app: `konnect.kuartalsystems.com` (live)
- Chat server: `matrix.kuartalsystems.com` (VPS, see docs/SERVER.md); Konnect IDs end in `kuartal.id`
- Store listing name **Kuartal Konnect**; home-screen name **Konnect**

## What works today

- Sign in with Kuartal ID; first-run setup (name, how people find you, notifications, recovery key)
- 1:1 and group chats, **end-to-end encrypted** by default; workspaces holding group chats
- Reply, edit, delete and react to messages; typing and read receipts
- **Encrypted photos and files** (up to 50 MB): drag and drop, paste, or the paperclip
- **Verification**: compare seven emoji with a contact or between your own devices; verified badges and a warning when someone's security key changes
- Chat info: members, rename a group, leave, **block** someone (and unblock in Settings)
- Find people by @handle, name or verified phone number, and choose how you can be found
- Recovery key: back up encryption and restore history on a new device; list of your devices
- **Personal CRM** next to every chat, encrypted in the browser, plus a Contacts view with follow-ups due
- Notifications while Konnect is open (also as an installed app); unread count on the tab and app icon
- Install as an app on phones and computers ("Konnect" on the home screen)
- KuartalOS: window title with unread count, notifications through the OS
- Light and dark theme, phone-width layout

Not yet: voice/video calls, notifications when Konnect is fully closed (needs a push service), signing out other devices from Konnect, message search, WhatsApp/Instagram inboxes, team CRM. See [STATUS.md](STATUS.md).

## Run it locally

```sh
npm install
VITE_HOMESERVER_URL=https://your-matrix-server npm run dev
```

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how it fits together, encryption and CRM privacy model, connected-apps plan
- [docs/SERVER.md](docs/SERVER.md): set up the chat server on a Hostinger VPS, no terminal
- [AGENTS.md](AGENTS.md): rules for AI contributors
