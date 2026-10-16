"""
Konnect server setup. Runs in the `setup` container before Synapse starts, on every deploy.

- Creates the server's secrets ONCE (database password, Synapse keys, discovery pepper) and keeps
  them in /data/konnect-secrets.json. Nobody ever copies or types a secret.
- Rewrites /data/homeserver.yaml from the environment on every start, so changing a setting in the
  Docker Manager (for example adding the WhatsApp details) takes effect on the next redeploy.
- Refuses to change SERVER_NAME once it has been used: it is part of every account ID.
"""

import json
import os
import secrets
import subprocess
import sys

DATA = "/data"
SECRETS = f"{DATA}/konnect-secrets.json"
CONFIG = f"{DATA}/homeserver.yaml"
DB_PASSWORD_FILE = "/secrets/db_password"


def env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def q(value: str) -> str:
    """YAML/JSON-safe quoted string."""
    return json.dumps(value)


def load_secrets() -> dict:
    if os.path.exists(SECRETS):
        with open(SECRETS) as f:
            return json.load(f)
    data = {
        "registration_shared_secret": secrets.token_urlsafe(48),
        "macaroon_secret_key": secrets.token_urlsafe(48),
        "form_secret": secrets.token_urlsafe(48),
        "discovery_pepper": secrets.token_urlsafe(48),
    }
    if os.path.exists(DB_PASSWORD_FILE):
        with open(DB_PASSWORD_FILE) as f:
            data["db_password"] = f.read().strip()
    else:
        data["db_password"] = secrets.token_urlsafe(32)
    save_secrets(data)
    return data


def save_secrets(data: dict) -> None:
    tmp = SECRETS + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2)
    os.chmod(tmp, 0o600)
    os.replace(tmp, SECRETS)


def main() -> None:
    os.makedirs(DATA, exist_ok=True)
    os.makedirs("/secrets", exist_ok=True)
    s = load_secrets()

    # Postgres reads its password from this shared file on first start.
    if not os.path.exists(DB_PASSWORD_FILE):
        with open(DB_PASSWORD_FILE, "w") as f:
            f.write(s["db_password"])
        os.chmod(DB_PASSWORD_FILE, 0o644)

    host = env("MATRIX_HOST", "matrix.kuartalsystems.com").removeprefix("https://").strip("/")
    server_name = env("SERVER_NAME", "kuartal.id")
    konnect_url = env("KONNECT_URL", "https://konnect.kuartalsystems.com").rstrip("/")
    issuer = env("KUARTAL_ID_ISSUER", "https://id.kuartal.id").rstrip("/")
    client_id = env("KUARTAL_ID_CLIENT_ID", "14d2db71-041a-4841-aca5-3218ff8b0023")

    locked = s.get("server_name")
    if locked and locked != server_name:
        sys.exit(
            f"Konnect setup: SERVER_NAME is {server_name!r} but this server was created as {locked!r}. "
            "It can't change once accounts exist. Set SERVER_NAME back."
        )
    if not locked:
        s["server_name"] = server_name
        save_secrets(s)

    wa_token = env("WHATSAPP_TOKEN")
    wa_number_id = env("WHATSAPP_PHONE_NUMBER_ID")
    if wa_token and wa_number_id:
        verifier = f"""      verifier: whatsapp
      whatsapp:
        token: {q(wa_token)}
        phone_number_id: {q(wa_number_id)}
        template: {q(env("WHATSAPP_TEMPLATE", "konnect_code"))}
        language: {q(env("WHATSAPP_LANGUAGE", "en"))}"""
    else:
        verifier = "      verifier: none"

    sso = ""
    if client_id:
        sso = f"""
oidc_providers:
  - idp_id: kuartal
    idp_name: "Kuartal ID"
    issuer: {q(issuer)}
    discover: true
    client_id: {q(client_id)}
    client_auth_method: none
    pkce_method: always
    scopes: ["openid", "profile", "email"]
    user_profile_method: userinfo_endpoint
    allow_existing_users: false
    user_mapping_provider:
      config:
        localpart_template: "{{{{ user.email.split('@')[0] | lower }}}}"
        display_name_template: "{{{{ user.name }}}}"
        confirm_localpart: true
"""

    config = f"""# Konnect chat server. WRITTEN BY THE SETUP CONTAINER ON EVERY START: edit the Docker settings,
# not this file. Secrets live in /data/konnect-secrets.json (created once, never printed).
server_name: {q(server_name)}
public_baseurl: {q(f"https://{host}/")}
pid_file: /data/homeserver.pid
report_stats: false
log_config: /data/log.config

listeners:
  - port: 8008
    type: http
    tls: false
    x_forwarded: true
    bind_addresses: ["0.0.0.0"]
    resources:
      - names: [client]
        compress: false

# Konnect starts as a closed network: no federation with other Matrix servers.
federation_domain_whitelist: []
trusted_key_servers: []

database:
  name: psycopg2
  args:
    user: synapse
    password: {q(s["db_password"])}
    database: synapse
    host: db
    cp_min: 5
    cp_max: 10

media_store_path: /data/media_store
signing_key_path: /data/signing.key
registration_shared_secret: {q(s["registration_shared_secret"])}
macaroon_secret_key: {q(s["macaroon_secret_key"])}
form_secret: {q(s["form_secret"])}
max_upload_size: 50M

# Accounts come from Kuartal ID. Open sign-up is off.
enable_registration: false
password_config:
  enabled: true

# Search covers everyone on this server; the discovery module hides people who opted out.
user_directory:
  enabled: true
  search_all_users: true

sso:
  client_whitelist:
    - {q(konnect_url + "/")}
  update_profile_information: true

# Konnect-branded sign-in pages (server/templates in the repo).
templates:
  custom_template_directory: /konnect/templates

# New chats are end-to-end encrypted by default, also for other Matrix apps.
encryption_enabled_by_default_for_room_type: all

modules:
  - module: konnect_discovery.KonnectDiscovery
    config:
      pepper: {q(s["discovery_pepper"])}
      default_region: {q(env("PHONE_DEFAULT_REGION", "ID"))}
{verifier}
{sso}"""

    with open(CONFIG + ".tmp", "w") as f:
        f.write(config)
    os.chmod(CONFIG + ".tmp", 0o600)
    os.replace(CONFIG + ".tmp", CONFIG)

    if not os.path.exists(f"{DATA}/log.config"):
        with open(f"{DATA}/log.config", "w") as f:
            f.write(LOG_CONFIG)

    subprocess.run([sys.executable, "-m", "synapse.app.homeserver", "--config-path", CONFIG, "--generate-keys"], check=True)
    subprocess.run(["chown", "-R", "991:991", DATA], check=False)
    print(f"Konnect setup: ready. Server {server_name} at https://{host}; phone codes: {'WhatsApp' if wa_token else 'off'}.")


# Log to the container output only (Docker keeps it), at INFO, without request bodies.
LOG_CONFIG = """version: 1
formatters:
  precise:
    format: '%(asctime)s - %(name)s - %(lineno)d - %(levelname)s - %(request)s - %(message)s'
filters:
  context:
    (): synapse.logging.context.LoggingContextFilter
    request: ""
handlers:
  console:
    class: logging.StreamHandler
    formatter: precise
    filters: [context]
loggers:
  synapse.storage.SQL:
    level: WARNING
root:
  level: INFO
  handlers: [console]
disable_existing_loggers: false
"""

if __name__ == "__main__":
    main()
