# Setting up the Konnect server (no terminal)

Konnect has two parts:

| Part | What it is | Where it runs |
| --- | --- | --- |
| **Web app** | The screens people use (`src/`). Static files. | Hostinger web hosting: `konnect.kuartalsystems.com` (live) |
| **Chat server** | Encrypted messages, accounts, workspaces, discovery. [Synapse](https://github.com/element-hq/synapse) + PostgreSQL + Caddy. | The Kuartal VPS (shared with Kuartal AI): `matrix.kuartalsystems.com` |

Decided settings (all defaults in `server/docker-compose.yml`, so nothing needs typing):

| Setting | Value |
| --- | --- |
| Konnect ID ending (`SERVER_NAME`) | `kuartal.id`, so IDs are `@handle:kuartal.id` and the app shows `@handle`. **Permanent**: the server refuses to start if it is changed later. |
| Chat server address (`MATRIX_HOST`) | `matrix.kuartalsystems.com` |
| Web app (`KONNECT_URL`) | `https://konnect.kuartalsystems.com` |
| Kuartal ID client | `14d2db71-041a-4841-aca5-3218ff8b0023`. Public client with PKCE (no secret), registered by `kuartal-id/kuartal-login` migration `2026_10_16_000100`. |

## Step 1: Register Konnect in Kuartal ID

Merge the `kuartal-login` PR "Register Konnect as a Kuartal ID app". Its deploy runs `migrate`, which creates the client. There's no terminal step and no secret.

## Step 2: DNS

hPanel → Domains → `kuartalsystems.com` → DNS records → add an **A record**: name `matrix`, pointing to the **VPS's IPv4 address** (hPanel → VPS → Overview).

## Step 3: Start the server on the VPS

**Option A: Docker Manager (no terminal).** hPanel → VPS → **Docker Manager** → Compose → *Deploy from URL*:

```
https://raw.githubusercontent.com/kuartal-id/konnect/main/server/docker-compose.yml
```

Project name `konnect`. Leave the environment empty. Deploy.

**Option B: if the Docker Manager isn't offered for this VPS.** hPanel → VPS → **Browser terminal**, paste this one line and press Enter:

```sh
mkdir -p /opt/konnect && cd /opt/konnect && curl -fsSL https://raw.githubusercontent.com/kuartal-id/konnect/main/server/docker-compose.yml -o docker-compose.yml && docker compose up -d
```

On first start, the `setup` container creates every password and key inside the server's private storage. Nobody sees or copies a secret. After a minute or two, `https://matrix.kuartalsystems.com` shows **"Konnect server is running."** The HTTPS certificate is automatic once DNS points at the VPS.

If hPanel → VPS → Security → **Firewall** has rules, allow TCP **80** and **443**. Ubuntu's own firewall (UFW) doesn't need changes, because Docker opens published ports itself.

## Sharing the VPS with Kuartal AI (how it's actually set up)

The Kuartal VPS already runs **Caddy on the host** (set up for KuartalOS's `api.os.kuartalsystems.com`), which holds ports 80/443. So on this VPS Konnect does **not** run its own Caddy:

- `/opt/konnect/docker-compose.override.yml` (copy of `server/shared-proxy/docker-compose.override.yml`) turns off Konnect's Caddy and publishes the chat server on `127.0.0.1:8008` only.
- `/etc/caddy/konnect.caddy` (copy of `server/shared-proxy/konnect.caddy`) is Konnect's site. `/etc/caddy/Caddyfile` loads it with one line at the end: `import /etc/caddy/konnect.caddy`. The KuartalOS sites in that Caddyfile are untouched. The pre-Konnect copy is `/etc/caddy/Caddyfile.pre-konnect`.
- Konnect doesn't touch the Kuartal AI gateway (`127.0.0.1:4000`), the KuartalOS API (`127.0.0.1:4100`), their databases or their Docker networks.

Set up on 2026-10-17 with one paste in the browser terminal. It wrote both files, validated the Caddyfile **before** reloading, and would have restored the backup if validation failed.

A fresh VPS with nothing on 80/443 doesn't need any of this: the plain `docker-compose.yml` brings its own Caddy.

## Updating

Merging to `main` doesn't touch the VPS. To update, paste this in the browser terminal:

```sh
cd /opt/konnect && curl -fsSL https://raw.githubusercontent.com/kuartal-id/konnect/main/server/docker-compose.yml -o docker-compose.yml && docker compose up -d
```

Settings, secrets and the `docker-compose.override.yml` are kept, and the server config is regenerated from the latest file.

## Phone-number discovery (WhatsApp codes)

People can be found by a phone number only after they prove it's theirs with a 6-digit code. Codes go out over **WhatsApp Cloud API** (Meta). Until it's set up, the app says phone verification isn't switched on, and handles still work fully.

1. Meta Business Suite → **WhatsApp** → set up a business phone number. This is the same number the future Konnect WhatsApp inbox will use.
2. WhatsApp Manager → Message templates → create **`konnect_code`**: category **Authentication**, language English (or Indonesian), with the **Copy code** button.
3. Business Settings → System users → create one, give it the WhatsApp app, and **generate a permanent token** with `whatsapp_business_messaging`.
4. Docker Manager → `konnect` → Environment → add:
   - `WHATSAPP_TOKEN` = the token. This is a secret: it lives only here, never in GitHub or chat.
   - `WHATSAPP_PHONE_NUMBER_ID` = the *Phone number ID* (a number, not the phone number)
   - `WHATSAPP_LANGUAGE` = `id` if the template is in Indonesian (default `en`)
5. Redeploy.

Meta charges per authentication message, a few hundred rupiah each in Indonesia. Each person can request at most 3 codes an hour.

## What's switched on

- Accounts come only from **Kuartal ID** (including its 2FA). On first sign-in, people choose their **@handle** on a Konnect-branded page; it can't change later. Open sign-up is off.
- **Discovery** (`server/modules/konnect_discovery.py`): search by name/@handle unless someone turns "Show me in search" off. Exact @handles always work. Verified phone numbers are stored only as a keyed hash plus a masked form (`+62 ••• 6789`). Lookups are rate-limited (30/hour, 100/day per person).
- **Every new chat is end-to-end encrypted**, also when made from other Matrix apps.
- **Closed network**: no federation with other Matrix servers.
- The admin API isn't exposed to the internet.

## Backups

Everything lives in the Docker volumes `konnect_synapse-data` (config, keys, uploads), `konnect_db-data` (database) and `konnect_db-secret`. Turn on Hostinger **VPS backups/snapshots**. Message contents are end-to-end encrypted, so a server backup can't be read without people's own keys.

## Later: WhatsApp and Instagram inboxes

See `docs/ARCHITECTURE.md` → "Connected apps". These are extra containers in the same Docker project, plus Meta business approval.
