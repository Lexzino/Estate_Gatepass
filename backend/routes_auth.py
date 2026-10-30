from datetime import timedelta
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, EmailStr, Field

from core import (APP_ENV, COLLECTION_BY_ROLE, audit, check_password_strength, current_user, db, dec, email_hash,
                  enc, hash_password, ip_hash, issue_tokens, new_id, norm_email, norm_phone, now, phone_hash,
                  pii_hash, rate_limit, refresh_hash, revoke_families, verify_password)
from push import register_device
from services import display_name

router = APIRouter(prefix="/api/auth", tags=["auth"])
misc = APIRouter(prefix="/api", tags=["push"])

NAME = r"^[A-Za-z][A-Za-z\s'\.\-]{1,79}$"
HOUSE = r"^[A-Za-z0-9][A-Za-z0-9\-/ ]{0,11}$"
PHONE = r"^\+?[0-9\s\-]{7,20}$"
DEVICE = r"^[A-Za-z0-9\-]{8,64}$"


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class RegisterIn(Strict):
    full_name: str = Field(pattern=NAME)
    phone: str = Field(pattern=PHONE)
    email: EmailStr
    password: str = Field(min_length=10, max_length=128)
    house_number: str = Field(pattern=HOUSE)
    estate_code: str = Field(min_length=2, max_length=12, pattern=r"^[A-Za-z0-9]+$")


class LoginIn(Strict):
    identifier: str = Field(min_length=5, max_length=120)
    password: str = Field(min_length=1, max_length=128)
    device_id: Optional[str] = Field(default=None, pattern=DEVICE)
    device_name: Optional[str] = Field(default=None, max_length=60)


class RefreshIn(Strict):
    refresh_token: str = Field(min_length=20, max_length=200)


class ResetIn(Strict):
    identifier: str = Field(min_length=5, max_length=120)


class VerifyOtpIn(Strict):
    identifier: str = Field(min_length=5, max_length=120)
    otp: str = Field(pattern=r"^\d{6}$")
    new_password: str = Field(min_length=10, max_length=128)


async def find_account(identifier: str) -> Optional[dict]:
    ident = identifier.strip()
    q = {"email_hash": email_hash(ident)} if "@" in ident else {"phone_hash": phone_hash(ident)}
    for col in COLLECTION_BY_ROLE.values():
        u = await db[col].find_one(q)
        if u:
            return u
    return None


def profile(u: dict) -> dict:
    out = {"id": u["id"], "role": u["role"], "full_name": u["full_name"], "status": u["status"]}
    if u["role"] == "resident":
        out.update({"estate_id": u["estate_id"], "house_number": u["house_number"],
                    "phone": dec(u.get("phone_encrypted")), "email": dec(u.get("email_encrypted"))})
    elif u["role"] == "guard":
        out.update({"estate_id": u["estate_id"], "device_status": u.get("device_status")})
    else:
        out.update({"estate_ids": u.get("estate_ids", [])})
    return out


@router.post("/register", status_code=201)
async def register(body: RegisterIn, request: Request):
    rate_limit(f"register:{ip_hash(request)}", 5, 3600)
    check_password_strength(body.password)
    estate = await db.estates.find_one({"code": body.estate_code.upper()})
    if not estate:
        raise HTTPException(404, "Estate code not recognised")
    if await find_account(body.email) or await find_account(body.phone):
        raise HTTPException(409, "An account with this email or phone already exists")
    doc = {
        "id": new_id(), "role": "resident", "estate_id": estate["id"], "full_name": body.full_name,
        "display_name": display_name(body.full_name), "house_number": body.house_number.upper(),
        "phone_encrypted": enc(norm_phone(body.phone)), "phone_hash": phone_hash(body.phone),
        "email_encrypted": enc(norm_email(body.email)), "email_hash": email_hash(body.email),
        "password_hash": hash_password(body.password), "status": "pending",
        "failed_logins": 0, "locked_until": None, "created_at": now(), "updated_at": now(),
    }
    await db.residents.insert_one(doc)
    await audit({"id": doc["id"], "role": "resident"}, "resident_registered", "resident", doc["id"], estate["id"], request=request)
    return {"message": "Registration received. Your estate admin will verify your household before you can sign in."}


@router.post("/login")
async def login(body: LoginIn, request: Request):
    ih = pii_hash("id:" + body.identifier.strip().lower())
    rate_limit(f"login-ip:{ip_hash(request)}", 20, 60)
    rate_limit(f"login-id:{ih}", 10, 900)
    u = await find_account(body.identifier)
    if u and u.get("locked_until") and u["locked_until"] > now():
        raise HTTPException(423, "Too many failed attempts. Try again in 15 minutes.")
    ok = verify_password(body.password, u["password_hash"] if u else None)
    if not ok:
        if u:
            fails = u.get("failed_logins", 0) + 1
            upd = {"failed_logins": fails}
            if fails >= 5:
                upd.update({"locked_until": now() + timedelta(minutes=15), "failed_logins": 0})
            await db[COLLECTION_BY_ROLE[u["role"]]].update_one({"id": u["id"]}, {"$set": upd})
        await audit(None, "login_failed", "account", u["id"] if u else None, u.get("estate_id") if u else None, request=request)
        raise HTTPException(401, "Invalid credentials")
    col = db[COLLECTION_BY_ROLE[u["role"]]]
    if u["status"] == "pending":
        raise HTTPException(403, "ACCOUNT_PENDING")
    if u["status"] != "active":
        raise HTTPException(403, "ACCOUNT_SUSPENDED")
    device_id = None
    if u["role"] == "guard":
        if not body.device_id:
            raise HTTPException(400, "Guard sign-in requires a registered device")
        if u.get("device_status") == "revoked":
            raise HTTPException(403, "DEVICE_REVOKED")
        if not u.get("device_id"):
            await col.update_one({"id": u["id"]}, {"$set": {"device_id": body.device_id, "device_status": "active",
                                                           "device_name": body.device_name or "Gate device",
                                                           "device_bound_at": now()}})
            await audit(u, "guard_device_bound", "guard", u["id"], u["estate_id"], request=request)
        elif u["device_id"] != body.device_id:
            await audit(u, "guard_login_unknown_device", "guard", u["id"], u["estate_id"], request=request)
            raise HTTPException(403, "DEVICE_NOT_AUTHORIZED")
        device_id = body.device_id
    await col.update_one({"id": u["id"]}, {"$set": {"failed_logins": 0, "locked_until": None, "last_login_at": now()}})
    await audit(u, "login_success", "account", u["id"], u.get("estate_id"), request=request)
    tokens = await issue_tokens(u, device_id)
    fresh = await col.find_one({"id": u["id"]})
    return {**tokens, "user": profile(fresh)}


@router.post("/refresh")
async def refresh(body: RefreshIn, request: Request):
    rate_limit(f"refresh:{ip_hash(request)}", 30, 60)
    h = refresh_hash(body.refresh_token)
    old = await db.refresh_tokens.find_one_and_update(
        {"token_hash": h, "used_at": None, "expires_at": {"$gt": now()}}, {"$set": {"used_at": now()}})
    if not old:
        found = await db.refresh_tokens.find_one({"token_hash": h})
        if found and found.get("used_at"):
            await revoke_families({"id": found["family_id"]})
            await audit({"id": found["user_id"], "role": found["role"]}, "refresh_token_reuse_detected",
                        "token_family", found["family_id"], request=request)
        raise HTTPException(401, "Session expired, please sign in again")
    fam = await db.token_families.find_one({"id": old["family_id"]})
    if not fam or fam.get("revoked_at"):
        raise HTTPException(401, "Session revoked")
    u = await db[COLLECTION_BY_ROLE[old["role"]]].find_one({"id": old["user_id"]})
    if not u or u["status"] != "active":
        raise HTTPException(401, "Account unavailable")
    if u["role"] == "guard" and (u.get("device_status") != "active" or u.get("device_id") != old.get("device_id")):
        raise HTTPException(403, "DEVICE_REVOKED")
    return await issue_tokens(u, old.get("device_id"), old["family_id"])


@router.post("/logout")
async def logout(body: RefreshIn, request: Request):
    found = await db.refresh_tokens.find_one({"token_hash": refresh_hash(body.refresh_token)})
    if found:
        await revoke_families({"id": found["family_id"]})
        await audit({"id": found["user_id"], "role": found["role"]}, "logout", "token_family", found["family_id"], request=request)
    return {"ok": True}


@router.post("/password-reset")
async def password_reset(body: ResetIn, request: Request):
    rate_limit(f"reset-ip:{ip_hash(request)}", 5, 900)
    u = await find_account(body.identifier)
    out = {"message": "If an account exists, a 6-digit code has been sent."}
    if u:
        code = f"{secrets.randbelow(10**6):06d}"
        await db.otp_codes.insert_one({"id": new_id(), "user_id": u["id"], "role": u["role"],
                                       "code_hash": pii_hash(f"otp:{u['id']}:{code}"), "attempts": 0,
                                       "used": False, "expires_at": now() + timedelta(minutes=10), "created_at": now()})
        await audit(u, "password_reset_requested", "account", u["id"], u.get("estate_id"), request=request)
        if APP_ENV == "development":
            out["dev_otp"] = code  # SMS delivery is not connected yet; dev only
    return out


@router.post("/verify-otp")
async def verify_otp(body: VerifyOtpIn, request: Request):
    rate_limit(f"otp-ip:{ip_hash(request)}", 10, 900)
    check_password_strength(body.new_password)
    u = await find_account(body.identifier)
    rec = await db.otp_codes.find_one({"user_id": u["id"], "used": False, "expires_at": {"$gt": now()}},
                                      sort=[("created_at", -1)]) if u else None
    if not rec or rec["attempts"] >= 5:
        raise HTTPException(400, "Code invalid or expired")
    if rec["code_hash"] != pii_hash(f"otp:{u['id']}:{body.otp}"):
        await db.otp_codes.update_one({"id": rec["id"]}, {"$inc": {"attempts": 1}})
        raise HTTPException(400, "Code invalid or expired")
    await db.otp_codes.update_one({"id": rec["id"]}, {"$set": {"used": True}})
    await db[COLLECTION_BY_ROLE[u["role"]]].update_one({"id": u["id"]}, {"$set": {
        "password_hash": hash_password(body.new_password), "updated_at": now(), "failed_logins": 0, "locked_until": None}})
    await revoke_families({"user_id": u["id"]})
    await audit(u, "password_reset_completed", "account", u["id"], u.get("estate_id"), request=request)
    return {"message": "Password updated. Please sign in."}


@router.get("/me")
async def me(u: dict = Depends(current_user)):
    return profile(u)


class PushIn(BaseModel):
    user_id: Optional[str] = None
    platform: str = Field(pattern=r"^(ios|android)$")
    device_token: str = Field(min_length=10, max_length=4096)


@misc.post("/register-push", status_code=201)
async def register_push(body: PushIn, u: dict = Depends(current_user)):
    await register_device(u["id"], body.platform, body.device_token)  # user id always from the session
    return {"status": "registered"}
