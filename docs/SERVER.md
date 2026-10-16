# Setting up the Konnect server (no terminal)

Konnect has two parts:

| Part | What it is | Where it runs |
| --- | --- | --- |
| **Web app** | The screens people use (this repo's `src/`). Static files. | Hostinger web hosting, like the other Kuartal sites: `konnect.kuartalsystems.com` |
| **Chat server** | Stores encrypted messages, accounts, workspaces. [Synapse](https://github.com/element-hq/synapse), the reference Matrix server. | A **Hostinger VPS** with Docker: `matrix.kuartalsystems.com` |

Regular Hostinger web hosting can't run the chat server, because the server has to stay running all the time. A VPS can.

## Decisions to make once

1. **Konnect ID domain (`SERVER_NAME`).** It's the part after the colon in everyone's ID, like `@diemas:kuartal.id`. **It can never change** once accounts exist. Recommended: `kuartal.id`.
2. **Chat server address (`MATRIX_HOST`).** Recommended: `matrix.kuartalsystems.com`. You can move this later.

## Step 1 — Register Konnect in Kuartal ID

This is a one-time change on the Kuartal ID server. Per the Kuartal ID rule, apps are registered server-side, not through an admin page. Whoever maintains `kuartal-id/kuartal-login` creates a **public client with PKCE**, so there's no client secret to handle:

- Name: `Konnect`
- Redirect URI: `https://matrix.kuartalsystems.com/_synapse/client/oidc/callback`
- Scopes: `openid profile email`
- Optional: a back-channel logout URI, later.

That gives a **client ID** (not secret) for Step 2. For example, Passport's `passport:client --public` produces it.

## Step 2 — Start the chat server on a Hostinger VPS

1. Create a VPS in hPanel with the **Ubuntu + Docker** template. KVM 2 (2 vCPU, 8 GB RAM) is plenty to start.
2. DNS (hPanel → Domains → kuartalsystems.com → DNS): add an **A record** `matrix` → the VPS IP address.
3. hPanel → VPS → **Docker Manager** → **Compose** → create a project named `konnect`. Paste `server/docker-compose.yml`, or its raw GitHub URL.
4. Fill in the **Environment** values. None of these are secrets:

   | Name | Example |
   | --- | --- |
   | `MATRIX_HOST` | `matrix.kuartalsystems.com` |
   | `SERVER_NAME` | `kuartal.id` |
   | `KONNECT_URL` | `https://konnect.kuartalsystems.com` |
   | `KUARTAL_ID_CLIENT_ID` | the client ID from Step 1 |

5. **Deploy.** On first start the `setup` container writes the config and creates every password and key by itself, inside the server's private storage. Within about a minute `https://matrix.kuartalsystems.com` shows "Konnect server is running." HTTPS certificates are automatic.

If the VPS template already runs another web proxy on ports 80/443 (Traefik, for example), remove the `caddy` service and point that proxy at `synapse:8008` for the paths `/_matrix` and `/_synapse/client`.

## Step 3 — Publish the web app on Hostinger

1. GitHub → `kuartal-id/konnect` → Settings → Secrets and variables → Actions → **Variables** → add `HOMESERVER_URL` = `https://matrix.kuartalsystems.com`.
2. Merging to `main` builds the app and publishes it to the `deploy` branch, the same as KuartalOS.
3. hPanel → Websites → add `konnect.kuartalsystems.com` → **Git** → repository `kuartal-id/konnect`, branch `deploy`, auto-deploy on.

The `.htaccess` that ships with the build allows Konnect to open inside KuartalOS windows (`os.kuartalsystems.com`), and nowhere else.

## Step 4 — Only if `SERVER_NAME` is a different domain from `MATRIX_HOST`

Other Matrix apps (Element, for example) find the server through a small file on the `SERVER_NAME` domain. Konnect itself doesn't need this. To let people use other Matrix apps too, add this file to the `kuartal.id` site as `/.well-known/matrix/client`:

```json
{ "m.homeserver": { "base_url": "https://matrix.kuartalsystems.com" } }
```

It must be served with the header `Access-Control-Allow-Origin: *`.

## What's switched on

- Accounts come only from **Kuartal ID**. On first sign-in, people confirm the Konnect ID suggested from their email. Open sign-up is off.
- **Every new chat is end-to-end encrypted**, including chats made from other Matrix apps.
- **Closed network**: no federation with other Matrix servers yet. To allow it later, remove `federation_domain_whitelist` from the config and add the federation listener.
- The admin API is not exposed to the internet.

## Backups

Everything lives in three Docker volumes: `konnect_synapse-data` (config, keys, uploads), `konnect_db-data` (database) and `konnect_db-secret`. Turn on Hostinger's **VPS snapshots/backups** in hPanel. Message contents are end-to-end encrypted, so a backup of the server can't be read without people's own keys.

## Later: WhatsApp and Instagram

See `docs/ARCHITECTURE.md` → "Connected apps". These are extra containers in the same Docker project, plus Meta business approval.
