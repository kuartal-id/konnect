"""
Konnect discovery: how people find each other on Konnect, and how each person controls it.

Runs inside Synapse as a module (configured under `modules:` in homeserver.yaml).

What it does
- Handle search: everyone can be found by @handle or name in search, unless they switch
  "Show me in search" off. Then only people who type their exact @handle can reach them.
  Enforced on the server through Synapse's user-directory filter.
- Phone numbers: a person can add ONE phone number, proven with a 6-digit code sent over WhatsApp.
  Only a keyed hash (HMAC-SHA256 with a server secret) and a masked form like "+62 ••• 6789" are
  stored, never the number itself. They choose whether people who know the number can find them.
- Phone lookup: signed-in people can look up a number they already know. It returns a match only if
  that person turned phone lookup on. Lookups are rate-limited per person to stop number guessing.

HTTP API (Matrix access token required), mounted at /_synapse/client/konnect/v1/:
  GET    settings                          -> current choices, masked phone, whether codes can be sent
  PUT    settings      {handle_search?, phone_lookup?}
  POST   phone/start   {phone}             -> sends a code
  POST   phone/confirm {code, phone_lookup}
  DELETE phone
  POST   lookup/phone  {phone}             -> {user_id, display_name} or 404
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
import time
from collections import defaultdict, deque
from typing import TYPE_CHECKING, Any

import attr
import phonenumbers
from synapse.api.errors import Codes, SynapseError
from synapse.http.server import DirectServeJsonResource
from synapse.http.servlet import parse_json_object_from_request
from synapse.module_api import ModuleApi
from synapse.types import UserProfile

if TYPE_CHECKING:
    from synapse.http.site import SynapseRequest

logger = logging.getLogger(__name__)

BASE_PATH = "/_synapse/client/konnect/v1"
CODE_TTL_S = 10 * 60
CODE_MAX_ATTEMPTS = 5


@attr.s(auto_attribs=True, frozen=True)
class WhatsAppConfig:
    token: str
    phone_number_id: str
    template: str = "konnect_code"
    language: str = "en"
    api_version: str = "v23.0"
    api_base: str = "https://graph.facebook.com"


@attr.s(auto_attribs=True, frozen=True)
class DiscoveryConfig:
    pepper: bytes
    default_region: str = "ID"
    verifier: str = "none"  # none | whatsapp | log (log is for local testing only)
    whatsapp: WhatsAppConfig | None = None
    lookups_per_hour: int = 30
    lookups_per_day: int = 100
    codes_per_hour: int = 3


class KonnectDiscovery:
    def __init__(self, config: DiscoveryConfig, api: ModuleApi):
        self.config = config
        self.api = api
        self._tables_ready = False
        self._lookups: dict[str, deque[float]] = defaultdict(deque)
        self._codes_sent: dict[str, deque[float]] = defaultdict(deque)

        api.register_spam_checker_callbacks(check_username_for_spam=self.check_username_for_spam)
        api.register_web_resource(BASE_PATH, DiscoveryResource(self))

    # ---- Config ------------------------------------------------------------------------------

    @staticmethod
    def parse_config(raw: dict[str, Any]) -> DiscoveryConfig:
        pepper = str(raw.get("pepper") or "")
        if len(pepper) < 32:
            raise Exception("konnect_discovery: 'pepper' must be a random secret of at least 32 characters")
        verifier = str(raw.get("verifier") or "none")
        if verifier not in ("none", "whatsapp", "log"):
            raise Exception("konnect_discovery: 'verifier' must be none, whatsapp or log")
        if verifier == "log" and not raw.get("allow_insecure_log_verifier"):
            raise Exception("konnect_discovery: the 'log' verifier is for local testing only")
        whatsapp = None
        wa = raw.get("whatsapp") or {}
        if verifier == "whatsapp":
            if not wa.get("token") or not wa.get("phone_number_id"):
                raise Exception("konnect_discovery: whatsapp.token and whatsapp.phone_number_id are required")
            whatsapp = WhatsAppConfig(
                token=str(wa["token"]),
                phone_number_id=str(wa["phone_number_id"]),
                template=str(wa.get("template") or "konnect_code"),
                language=str(wa.get("language") or "en"),
                api_version=str(wa.get("api_version") or "v23.0"),
                api_base=str(wa.get("api_base") or "https://graph.facebook.com").rstrip("/"),
            )
        limits = raw.get("limits") or {}
        return DiscoveryConfig(
            pepper=pepper.encode("utf-8"),
            default_region=str(raw.get("default_region") or "ID").upper(),
            verifier=verifier,
            whatsapp=whatsapp,
            lookups_per_hour=int(limits.get("lookups_per_hour", 30)),
            lookups_per_day=int(limits.get("lookups_per_day", 100)),
            codes_per_hour=int(limits.get("codes_per_hour", 3)),
        )

    # ---- Storage -------------------------------------------------------------------------------

    async def ensure_tables(self) -> None:
        if self._tables_ready:
            return

        def create(txn: Any) -> None:
            txn.execute(
                "CREATE TABLE IF NOT EXISTS konnect_discovery_settings ("
                " user_id TEXT PRIMARY KEY, handle_search INTEGER NOT NULL,"
                " phone_lookup INTEGER NOT NULL, updated_ts BIGINT NOT NULL)"
            )
            txn.execute(
                "CREATE TABLE IF NOT EXISTS konnect_phones ("
                " phone_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE,"
                " masked TEXT NOT NULL, verified_ts BIGINT NOT NULL)"
            )
            txn.execute(
                "CREATE TABLE IF NOT EXISTS konnect_phone_codes ("
                " user_id TEXT PRIMARY KEY, phone_hash TEXT NOT NULL, masked TEXT NOT NULL,"
                " code_hash TEXT NOT NULL, expires_ts BIGINT NOT NULL, attempts INTEGER NOT NULL)"
            )

        await self.api.run_db_interaction("konnect_discovery_create_tables", create)
        self._tables_ready = True

    async def get_settings(self, user_id: str) -> dict[str, bool]:
        await self.ensure_tables()

        def get(txn: Any) -> Any:
            txn.execute(
                "SELECT handle_search, phone_lookup FROM konnect_discovery_settings WHERE user_id = ?",
                (user_id,),
            )
            return txn.fetchone()

        row = await self.api.run_db_interaction("konnect_discovery_get_settings", get)
        if not row:
            return {"handle_search": True, "phone_lookup": False}
        return {"handle_search": bool(row[0]), "phone_lookup": bool(row[1])}

    async def set_settings(self, user_id: str, handle_search: bool, phone_lookup: bool) -> None:
        await self.ensure_tables()

        def put(txn: Any) -> None:
            txn.execute("DELETE FROM konnect_discovery_settings WHERE user_id = ?", (user_id,))
            txn.execute(
                "INSERT INTO konnect_discovery_settings (user_id, handle_search, phone_lookup, updated_ts)"
                " VALUES (?, ?, ?, ?)",
                (user_id, int(handle_search), int(phone_lookup), _now_ms()),
            )

        await self.api.run_db_interaction("konnect_discovery_set_settings", put)

    async def get_phone(self, user_id: str) -> dict[str, Any] | None:
        await self.ensure_tables()

        def get(txn: Any) -> Any:
            txn.execute("SELECT masked, verified_ts FROM konnect_phones WHERE user_id = ?", (user_id,))
            return txn.fetchone()

        row = await self.api.run_db_interaction("konnect_discovery_get_phone", get)
        return {"masked": row[0], "verified_ts": row[1]} if row else None

    # ---- Phone numbers -------------------------------------------------------------------------

    def normalize(self, raw: Any) -> str:
        if not isinstance(raw, str) or not raw.strip():
            raise SynapseError(400, "Enter a phone number.", Codes.MISSING_PARAM)
        text = raw.strip()
        # People in Indonesia often write 62812... without the plus.
        if text[0].isdigit() and not text.startswith("0") and len(_digits(text)) >= 10:
            candidates = ["+" + _digits(text), text]
        else:
            candidates = [text]
        for candidate in candidates:
            try:
                parsed = phonenumbers.parse(candidate, self.config.default_region)
            except phonenumbers.NumberParseException:
                continue
            if phonenumbers.is_valid_number(parsed):
                return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)
        raise SynapseError(400, "That isn't a valid phone number. Include the country code, like +62.", Codes.INVALID_PARAM)

    def phone_hash(self, e164: str) -> str:
        return hmac.new(self.config.pepper, e164.encode("utf-8"), hashlib.sha256).hexdigest()

    def code_hash(self, user_id: str, code: str) -> str:
        return hmac.new(self.config.pepper, f"code|{user_id}|{code}".encode("utf-8"), hashlib.sha256).hexdigest()

    @staticmethod
    def mask(e164: str) -> str:
        parsed = phonenumbers.parse(e164, None)
        national = str(parsed.national_number)
        return f"+{parsed.country_code} ••• {national[-4:]}"

    async def start_verification(self, user_id: str, raw_phone: Any) -> dict[str, Any]:
        if self.config.verifier == "none":
            raise SynapseError(
                503, "Phone verification isn't switched on for this server yet.", "KONNECT_PHONE_UNAVAILABLE"
            )
        e164 = self.normalize(raw_phone)
        phone_hash = self.phone_hash(e164)
        _take(self._codes_sent[user_id], self.config.codes_per_hour, 3600, "Too many codes requested. Try again in an hour.")
        _take(self._codes_sent["phone:" + phone_hash], self.config.codes_per_hour, 3600, "Too many codes for that number. Try again in an hour.")

        code = f"{secrets.randbelow(1_000_000):06d}"
        masked = self.mask(e164)
        await self.ensure_tables()

        def put(txn: Any) -> None:
            txn.execute("DELETE FROM konnect_phone_codes WHERE user_id = ?", (user_id,))
            txn.execute(
                "INSERT INTO konnect_phone_codes (user_id, phone_hash, masked, code_hash, expires_ts, attempts)"
                " VALUES (?, ?, ?, ?, ?, 0)",
                (user_id, phone_hash, masked, self.code_hash(user_id, code), _now_ms() + CODE_TTL_S * 1000),
            )

        await self.api.run_db_interaction("konnect_discovery_store_code", put)
        await self.send_code(e164, code)
        return {"masked": masked, "expires_in": CODE_TTL_S}

    async def send_code(self, e164: str, code: str) -> None:
        if self.config.verifier == "log":
            logger.warning("KONNECT TEST CODE for %s: %s (log verifier: never use in production)", self.mask(e164), code)
            return
        wa = self.config.whatsapp
        assert wa is not None
        body = {
            "messaging_product": "whatsapp",
            "to": e164.lstrip("+"),
            "type": "template",
            "template": {
                "name": wa.template,
                "language": {"code": wa.language},
                "components": [
                    {"type": "body", "parameters": [{"type": "text", "text": code}]},
                    {"type": "button", "sub_type": "url", "index": "0", "parameters": [{"type": "text", "text": code}]},
                ],
            },
        }
        url = f"{wa.api_base}/{wa.api_version}/{wa.phone_number_id}/messages"
        try:
            await self.api.http_client.post_json_get_json(url, body, headers={"Authorization": [f"Bearer {wa.token}"]})
        except Exception:
            logger.exception("Konnect: sending the WhatsApp code failed")
            raise SynapseError(502, "Couldn't send the code over WhatsApp. Try again in a moment.", Codes.UNKNOWN)

    async def confirm_verification(self, user_id: str, code: Any, phone_lookup: bool) -> dict[str, Any]:
        if not isinstance(code, str) or not code.strip().isdigit():
            raise SynapseError(400, "Enter the 6-digit code.", Codes.INVALID_PARAM)
        code = code.strip()
        expected = self.code_hash(user_id, code)
        await self.ensure_tables()

        def check(txn: Any) -> Any:
            txn.execute(
                "SELECT phone_hash, masked, code_hash, expires_ts, attempts FROM konnect_phone_codes WHERE user_id = ?",
                (user_id,),
            )
            row = txn.fetchone()
            if not row:
                return "missing"
            phone_hash, masked, code_hash, expires_ts, attempts = row
            if expires_ts < _now_ms() or attempts >= CODE_MAX_ATTEMPTS:
                txn.execute("DELETE FROM konnect_phone_codes WHERE user_id = ?", (user_id,))
                return "expired"
            if not hmac.compare_digest(code_hash, expected):
                txn.execute("UPDATE konnect_phone_codes SET attempts = attempts + 1 WHERE user_id = ?", (user_id,))
                return "wrong"
            txn.execute("DELETE FROM konnect_phone_codes WHERE user_id = ?", (user_id,))
            # A number belongs to whoever proved it most recently (numbers get recycled).
            txn.execute("DELETE FROM konnect_phones WHERE phone_hash = ? OR user_id = ?", (phone_hash, user_id))
            txn.execute(
                "INSERT INTO konnect_phones (phone_hash, user_id, masked, verified_ts) VALUES (?, ?, ?, ?)",
                (phone_hash, user_id, masked, _now_ms()),
            )
            return masked

        result = await self.api.run_db_interaction("konnect_discovery_confirm_code", check)
        if result == "missing":
            raise SynapseError(400, "Request a new code first.", Codes.INVALID_PARAM)
        if result == "expired":
            raise SynapseError(400, "That code has expired. Request a new one.", Codes.INVALID_PARAM)
        if result == "wrong":
            raise SynapseError(400, "That code isn't right.", Codes.INVALID_PARAM)
        settings = await self.get_settings(user_id)
        await self.set_settings(user_id, settings["handle_search"], bool(phone_lookup))
        return {"masked": result}

    async def remove_phone(self, user_id: str) -> None:
        await self.ensure_tables()

        def delete(txn: Any) -> None:
            txn.execute("DELETE FROM konnect_phones WHERE user_id = ?", (user_id,))
            txn.execute("DELETE FROM konnect_phone_codes WHERE user_id = ?", (user_id,))

        await self.api.run_db_interaction("konnect_discovery_remove_phone", delete)
        settings = await self.get_settings(user_id)
        await self.set_settings(user_id, settings["handle_search"], False)

    async def lookup_phone(self, requester: str, raw_phone: Any) -> dict[str, Any]:
        _take(self._lookups[requester], self.config.lookups_per_hour, 3600, "Too many lookups. Try again later.")
        _take(self._lookups["day:" + requester], self.config.lookups_per_day, 86400, "Too many lookups today.")
        e164 = self.normalize(raw_phone)
        await self.ensure_tables()

        def find(txn: Any) -> Any:
            txn.execute(
                "SELECT p.user_id FROM konnect_phones p"
                " JOIN konnect_discovery_settings s ON s.user_id = p.user_id"
                " WHERE p.phone_hash = ? AND s.phone_lookup = 1",
                (self.phone_hash(e164),),
            )
            return txn.fetchone()

        row = await self.api.run_db_interaction("konnect_discovery_lookup_phone", find)
        not_found = SynapseError(404, "No one on Konnect can be found with that number.", Codes.NOT_FOUND)
        if not row or row[0] == requester:
            raise not_found
        info = await self.api.get_userinfo_by_id(row[0])
        if not info or info.is_deactivated or info.locked or info.suspended:
            raise not_found
        display_name = None
        try:
            profile = await self.api.get_profile_for_user(info.user_id.localpart)
            display_name = profile.display_name
        except Exception:
            pass
        return {"user_id": row[0], "display_name": display_name}

    # ---- User directory filter -----------------------------------------------------------------

    async def check_username_for_spam(self, user_profile: UserProfile, requester_id: str) -> bool:
        """Returning True hides this person from search results."""
        user_id = user_profile["user_id"]
        if user_id == requester_id:
            return False
        try:
            return not (await self.get_settings(user_id))["handle_search"]
        except Exception:
            logger.exception("Konnect: couldn't read discovery settings; hiding %s from search", user_id)
            return True


class DiscoveryResource(DirectServeJsonResource):
    isLeaf = True

    def __init__(self, module: KonnectDiscovery):
        super().__init__()
        self.module = module

    def _route(self, request: "SynapseRequest") -> str:
        path = request.path.decode("utf-8") if request.path else ""
        return path[len(BASE_PATH) :].strip("/") if path.startswith(BASE_PATH) else ""

    async def _async_render_OPTIONS(self, request: "SynapseRequest") -> tuple[int, dict]:
        return 200, {}

    async def _async_render_GET(self, request: "SynapseRequest") -> tuple[int, dict]:
        user_id = await self._user(request)
        if self._route(request) != "settings":
            raise SynapseError(404, "Not found", Codes.NOT_FOUND)
        settings = await self.module.get_settings(user_id)
        phone = await self.module.get_phone(user_id)
        return 200, {
            "handle_search": settings["handle_search"],
            "phone": {"masked": phone["masked"], "lookup": settings["phone_lookup"]} if phone else None,
            "phone_verification": self.module.config.verifier != "none",
        }

    async def _async_render_PUT(self, request: "SynapseRequest") -> tuple[int, dict]:
        user_id = await self._user(request)
        if self._route(request) != "settings":
            raise SynapseError(404, "Not found", Codes.NOT_FOUND)
        body = parse_json_object_from_request(request)
        current = await self.module.get_settings(user_id)
        handle_search = _bool(body.get("handle_search"), current["handle_search"])
        phone_lookup = _bool(body.get("phone_lookup"), current["phone_lookup"])
        if phone_lookup and not await self.module.get_phone(user_id):
            phone_lookup = False
        await self.module.set_settings(user_id, handle_search, phone_lookup)
        return 200, {"handle_search": handle_search, "phone_lookup": phone_lookup}

    async def _async_render_POST(self, request: "SynapseRequest") -> tuple[int, dict]:
        user_id = await self._user(request)
        route = self._route(request)
        body = parse_json_object_from_request(request)
        if route == "phone/start":
            return 200, await self.module.start_verification(user_id, body.get("phone"))
        if route == "phone/confirm":
            return 200, await self.module.confirm_verification(user_id, body.get("code"), bool(body.get("phone_lookup", True)))
        if route == "lookup/phone":
            return 200, await self.module.lookup_phone(user_id, body.get("phone"))
        raise SynapseError(404, "Not found", Codes.NOT_FOUND)

    async def _async_render_DELETE(self, request: "SynapseRequest") -> tuple[int, dict]:
        user_id = await self._user(request)
        if self._route(request) != "phone":
            raise SynapseError(404, "Not found", Codes.NOT_FOUND)
        await self.module.remove_phone(user_id)
        return 200, {}

    async def _user(self, request: "SynapseRequest") -> str:
        requester = await self.module.api.get_user_by_req(request)
        return requester.user.to_string()


def _now_ms() -> int:
    return int(time.time() * 1000)


def _digits(text: str) -> str:
    return "".join(ch for ch in text if ch.isdigit())


def _bool(value: Any, default: bool) -> bool:
    return value if isinstance(value, bool) else default


def _take(window: deque[float], limit: int, period_s: int, message: str) -> None:
    now = time.monotonic()
    while window and now - window[0] > period_s:
        window.popleft()
    if len(window) >= limit:
        raise SynapseError(429, message, Codes.LIMIT_EXCEEDED)
    window.append(now)
