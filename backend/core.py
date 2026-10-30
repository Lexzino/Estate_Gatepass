"""EstateGate core: config, database, crypto, auth helpers, audit, rate limiting, log redaction."""
import asyncio
import base64
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import jwt  # noqa: E402
from argon2 import PasswordHasher  # noqa: E402
from argon2.exceptions import InvalidHashError, VerifyMismatchError  # noqa: E402
from cryptography.exceptions import InvalidSignature  # noqa: E402
from cryptography.fernet import Fernet, InvalidToken  # noqa: E402
from cryptography.hazmat.primitives import serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey  # noqa: E402
from fastapi import Depends, HTTPException, Request  # noqa: E402
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer  # noqa: E402
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402
from pymongo.errors import DuplicateKeyError  # noqa: E402

# ---------------------------------------------------------------- config
APP_ENV = os.environ["APP_ENV"]
ACCESS_SECRET = os.environ["ACCESS_TOKEN_SECRET"]
REFRESH_SECRET = os.environ["REFRESH_TOKEN_SECRET"]
PII_KEY = os.environ["PII_HASH_KEY"].encode()
FERNET = Fernet(os.environ["FIELD_ENCRYPTION_KEY"].encode())
SIGNING_KEY_ID = os.environ["SIGNING_KEY_ID"]
ACCESS_MINUTES = 15
REFRESH_DAYS = 30
ISSUER = "estategate-api"
AUDIENCE = "estategate-apps"

client = AsyncIOMotorClient(os.environ["MONGO_URL"], tz_aware=True)
db = client[os.environ["DB_NAME"]]


def now() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return uuid.uuid4().hex


def clean(doc: Optional[dict], drop: tuple = ()) -> Optional[dict]:
    """Strip Mongo _id and any secret fields before returning a document."""
    if doc is None:
        return None
    return {k: v for k, v in doc.items() if k != "_id" and k not in drop}


# ---------------------------------------------------------------- log redaction
_REDACTIONS = [
    (re.compile(r"EG1\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+"), "EG1.[REDACTED]"),
    (re.compile(r"(?i)bearer\s+[A-Za-z0-9_\-\.]+"), "Bearer [REDACTED]"),
    (re.compile(r"\+?\d[\d\s\-]{8,}\d"), "[PHONE-REDACTED]"),
    (re.compile(r"[\w\.\-]+@[\w\-]+\.[\w\.]+"), "[EMAIL-REDACTED]"),
]


class RedactFilter(logging.Filter):
    @staticmethod
    def _redact(s: str) -> str:
        for pat, rep in _REDACTIONS:
            s = pat.sub(rep, s)
        return s

    def filter(self, record: logging.LogRecord) -> bool:
        # uvicorn.access formatter unpacks record.args (5-tuple), so redact args in place for that logger
        if record.name == "uvicorn.access" and isinstance(record.args, tuple):
            record.args = tuple(self._redact(a) if isinstance(a, str) else a for a in record.args)
            return True
        record.msg, record.args = self._redact(record.getMessage()), ()
        return True


def setup_logging():
    logging.basicConfig(level=logging.INFO, format='{"t":"%(asctime)s","lvl":"%(levelname)s","log":"%(name)s","msg":"%(message)s"}')
    for h in logging.getLogger().handlers:
        h.addFilter(RedactFilter())
    for name in ("uvicorn.access", "uvicorn.error"):
        for h in logging.getLogger(name).handlers:
            h.addFilter(RedactFilter())


logger = logging.getLogger("estategate")

# ---------------------------------------------------------------- field encryption + hashing
def enc(value: Optional[str]) -> Optional[str]:
    return FERNET.encrypt(value.encode()).decode() if value else None


def dec(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    try:
        return FERNET.decrypt(value.encode()).decode()
    except InvalidToken:
        return None


def norm_phone(phone: str) -> str:
    digits = re.sub(r"[^\d+]", "", phone or "")
    if digits.startswith("00"):
        digits = "+" + digits[2:]
    if digits.startswith("0") and len(digits) == 11:  # Nigerian local format
        digits = "+234" + digits[1:]
    if not digits.startswith("+"):
        digits = "+" + digits
    return digits


def norm_email(email: str) -> str:
    return (email or "").strip().lower()


def pii_hash(value: str) -> str:
    """Keyed HMAC so lookups work without storing plaintext and hashes can't be brute-forced offline."""
    return hmac.new(PII_KEY, value.encode(), hashlib.sha256).hexdigest()


def phone_hash(phone: str) -> str:
    return pii_hash("phone:" + norm_phone(phone))


def email_hash(email: str) -> str:
    return pii_hash("email:" + norm_email(email))


def mask_phone(phone: Optional[str]) -> Optional[str]:
    if not phone:
        return None
    return phone[:4] + " *** *** " + phone[-3:]


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def ip_hash(request: Optional[Request]) -> Optional[str]:
    if request is None:
        return None
    # Last hop is appended by our ingress; earlier values are client-controlled and spoofable.
    ip = request.headers.get("x-forwarded-for", "").split(",")[-1].strip() or (request.client.host if request.client else "")
    return pii_hash("ip:" + ip)[:24]


# ---------------------------------------------------------------- passwords (Argon2id)
_ph = PasswordHasher()  # argon2-cffi defaults to Argon2id
_DUMMY_HASH = _ph.hash("dummy-password-for-timing")
PASSWORD_RULE = re.compile(r"^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z\d]).{10,128}$")


def hash_password(pw: str) -> str:
    return _ph.hash(pw)


def verify_password(pw: str, hashed: Optional[str]) -> bool:
    try:
        return _ph.verify(hashed or _DUMMY_HASH, pw) and hashed is not None
    except (VerifyMismatchError, InvalidHashError):
        return False


def check_password_strength(pw: str):
    if not PASSWORD_RULE.match(pw or ""):
        raise HTTPException(422, "Password must be 10+ characters with a letter, a number and a symbol")


# ---------------------------------------------------------------- pass signing (Ed25519)
def _b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _b64u_dec(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _load_keys():
    priv = Ed25519PrivateKey.from_private_bytes(base64.b64decode(os.environ["SIGNING_KEY_SEED"]))
    keys = {SIGNING_KEY_ID: priv.public_key()}
    # Previous keys stay valid for verification during rotation: "kid:base64seed,kid2:seed"
    for item in filter(None, os.environ.get("SIGNING_KEYS_PREVIOUS", "").split(",")):
        kid, seed = item.split(":", 1)
        keys[kid] = Ed25519PrivateKey.from_private_bytes(base64.b64decode(seed)).public_key()
    return priv, keys


_SIGNING_PRIV, _VERIFY_KEYS = _load_keys()


def public_keys() -> dict:
    return {
        kid: base64.b64encode(k.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()
        for kid, k in _VERIFY_KEYS.items()
    }


def sign_pass(estate_code: str, valid_from: datetime, valid_to: datetime) -> tuple[str, str, str]:
    """Return (token, signature, nonce). Token holds no PII: estate code, nonce, 128-bit secret, window, key id."""
    nonce = _b64u(secrets.token_bytes(12))
    payload = {
        "v": 1, "ec": estate_code, "n": nonce, "s": _b64u(secrets.token_bytes(16)),
        "f": int(valid_from.timestamp()), "t": int(valid_to.timestamp()), "k": SIGNING_KEY_ID,
    }
    body = _b64u(json.dumps(payload, separators=(",", ":")).encode())
    sig = _b64u(_SIGNING_PRIV.sign(body.encode()))
    return f"EG1.{body}.{sig}", sig, nonce


def verify_pass(token: str) -> Optional[dict]:
    try:
        prefix, body, sig = token.strip().split(".")
        if prefix != "EG1" or len(token) > 600:
            return None
        payload = json.loads(_b64u_dec(body))
        key = _VERIFY_KEYS.get(payload.get("k"))
        if key is None:
            return None
        key.verify(_b64u_dec(sig), body.encode())
        return payload
    except (ValueError, InvalidSignature, json.JSONDecodeError, TypeError):
        return None


# ---------------------------------------------------------------- rate limiting
_buckets: dict[str, deque] = defaultdict(deque)


def rate_limit(key: str, limit: int, window_s: int):
    """Sliding-window limiter (in-process). Swap for Redis when running >1 API instance."""
    t = time.monotonic()
    q = _buckets[key]
    while q and q[0] <= t - window_s:
        q.popleft()
    if len(q) >= limit:
        raise HTTPException(429, "Too many requests. Please wait and try again.")
    q.append(t)


def reset_rate_limits():
    _buckets.clear()


# ---------------------------------------------------------------- audit log (append-only, hash-chained)
_audit_lock = asyncio.Lock()


async def audit(actor: Optional[dict], action: str, entity_type: str = None, entity_id: str = None,
                estate_id: str = None, metadata: dict = None, request: Request = None):
    # Serialise chain appends in-process; retry on a seq clash from another API instance.
    async with _audit_lock:
        for _ in range(5):
            try:
                return await _append_audit(actor, action, entity_type, entity_id, estate_id, metadata, request)
            except DuplicateKeyError:
                await asyncio.sleep(0.02)
    logger.error("audit append failed after retries")


async def _append_audit(actor, action, entity_type, entity_id, estate_id, metadata, request):
    last = await db.audit_logs.find_one({}, sort=[("seq", -1)])
    seq = (last["seq"] + 1) if last else 1
    entry = {
        "id": new_id(), "seq": seq,
        "actor_id": actor.get("id") if actor else None,
        "actor_role": actor.get("role") if actor else "system",
        "action": action, "entity_type": entity_type, "entity_id": entity_id,
        "estate_id": estate_id, "metadata": metadata or {},
        "ip_address_hash": ip_hash(request),
        # Mongo stores milliseconds; truncate so the hash chain re-verifies after a round trip
        "created_at": (t := now()).replace(microsecond=t.microsecond // 1000 * 1000),
    }
    chain_src = (last["hash"] if last else "genesis") + json.dumps({k: str(v) for k, v in entry.items()}, sort_keys=True)
    entry["prev_hash"] = last["hash"] if last else "genesis"
    entry["hash"] = sha256_hex(chain_src)
    await db.audit_logs.insert_one(entry)


# ---------------------------------------------------------------- JWT + refresh tokens
COLLECTION_BY_ROLE = {"resident": "residents", "guard": "guards", "admin": "admins"}


def make_access_token(user: dict, family_id: str, device_id: Optional[str]) -> str:
    t = now()
    return jwt.encode({
        "sub": user["id"], "role": user["role"], "fam": family_id, "dev": device_id,
        "iat": t, "exp": t + timedelta(minutes=ACCESS_MINUTES), "iss": ISSUER, "aud": AUDIENCE,
        "jti": secrets.token_urlsafe(12), "typ": "access",
    }, ACCESS_SECRET, algorithm="HS256")


def refresh_hash(raw: str) -> str:
    return hmac.new(REFRESH_SECRET.encode(), raw.encode(), hashlib.sha256).hexdigest()


async def issue_tokens(user: dict, device_id: Optional[str], family_id: Optional[str] = None) -> dict:
    if family_id is None:
        family_id = new_id()
        await db.token_families.insert_one({
            "id": family_id, "user_id": user["id"], "role": user["role"], "device_id": device_id,
            "created_at": now(), "revoked_at": None,
        })
    raw = secrets.token_urlsafe(48)
    await db.refresh_tokens.insert_one({
        "id": new_id(), "token_hash": refresh_hash(raw), "family_id": family_id, "user_id": user["id"],
        "role": user["role"], "device_id": device_id, "created_at": now(),
        "expires_at": now() + timedelta(days=REFRESH_DAYS), "used_at": None,
    })
    return {"access_token": make_access_token(user, family_id, device_id), "refresh_token": raw,
            "token_type": "bearer", "expires_in": ACCESS_MINUTES * 60}


async def revoke_families(query: dict):
    await db.token_families.update_many({**query, "revoked_at": None}, {"$set": {"revoked_at": now()}})


_bearer = HTTPBearer(auto_error=False)


async def current_user(request: Request, cred: HTTPAuthorizationCredentials = Depends(_bearer)) -> dict:
    if not cred:
        raise HTTPException(401, "Not authenticated")
    try:
        p = jwt.decode(cred.credentials, ACCESS_SECRET, algorithms=["HS256"], audience=AUDIENCE, issuer=ISSUER,
                       options={"require": ["sub", "exp", "iat", "role", "fam"]})
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Session expired")
    if p.get("typ") != "access" or p["role"] not in COLLECTION_BY_ROLE:
        raise HTTPException(401, "Invalid token")
    fam = await db.token_families.find_one({"id": p["fam"]})
    if not fam or fam.get("revoked_at"):
        raise HTTPException(401, "Session revoked")
    user = await db[COLLECTION_BY_ROLE[p["role"]]].find_one({"id": p["sub"]})
    if not user or user.get("status") != "active":
        raise HTTPException(401, "Account unavailable")
    if p["role"] == "guard":
        if user.get("device_status") != "active" or user.get("device_id") != p.get("dev"):
            raise HTTPException(403, "DEVICE_REVOKED")
        await db.guards.update_one({"id": user["id"]}, {"$set": {"last_active_at": now()}})
    user["_device_id"] = p.get("dev")
    return user


def require_role(*roles: str):
    async def dep(user: dict = Depends(current_user)) -> dict:
        if user["role"] not in roles:
            raise HTTPException(403, "Not allowed for your role")
        return user
    return dep
