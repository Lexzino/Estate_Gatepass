from datetime import datetime, timedelta, timezone
import json
from typing import Literal, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import EmailStr, Field

from core import (audit, check_password_strength, db, dec, email_hash, enc, hash_password, mask_phone, new_id,
                  norm_email, norm_phone, now, phone_hash, require_role, revoke_families, sha256_hex)
from routes_auth import HOUSE, NAME, PHONE, Strict, find_account
from services import display_name, get_estate, refresh_expired, run_retention, visitors_by_id

router = APIRouter(prefix="/api/admin", tags=["admin"])
admin_only = require_role("admin")


async def scoped(a: dict, estate_id: Optional[str]) -> dict:
    ids = a.get("estate_ids", [])
    eid = estate_id or (ids[0] if ids else None)
    if not eid or eid not in ids:
        raise HTTPException(404, "Estate not found")
    return await get_estate(eid)


def estate_out(e: dict) -> dict:
    return {k: e.get(k) for k in ("id", "name", "code", "address", "timezone", "access_rules", "created_at", "last_retention_run")}


class EstateIn(Strict):
    name: str = Field(min_length=3, max_length=80)
    code: str = Field(pattern=r"^[A-Z0-9]{2,12}$")
    address: str = Field(min_length=3, max_length=160)
    timezone: str = "Africa/Lagos"


DEFAULT_RULES = {"retention_days": 180, "offline_cache_hours": 48, "walk_in_pass_minutes": 60, "default_one_time_hours": 6}


@router.post("/estates", status_code=201)
async def create_estate(body: EstateIn, a: dict = Depends(admin_only)):
    try:
        ZoneInfo(body.timezone)
    except ZoneInfoNotFoundError:
        raise HTTPException(422, "Unknown timezone")
    if await db.estates.find_one({"code": body.code}):
        raise HTTPException(409, "Estate code already in use")
    e = {"id": new_id(), **body.model_dump(), "access_rules": dict(DEFAULT_RULES), "created_at": now(), "updated_at": now()}
    await db.estates.insert_one(e)
    await db.admins.update_one({"id": a["id"]}, {"$addToSet": {"estate_ids": e["id"]}})
    await audit(a, "estate_created", "estate", e["id"], e["id"])
    return estate_out(e)


@router.get("/estates")
async def list_estates(a: dict = Depends(admin_only)):
    return [estate_out(e) for e in await db.estates.find({"id": {"$in": a.get("estate_ids", [])}}).to_list(50)]


class RulesIn(Strict):
    retention_days: Literal[90, 180, 365]
    offline_cache_hours: int = Field(ge=24, le=72)
    walk_in_pass_minutes: int = Field(ge=15, le=240)
    default_one_time_hours: int = Field(ge=1, le=24)


@router.put("/estates/{estate_id}/rules")
async def update_rules(estate_id: str, body: RulesIn, a: dict = Depends(admin_only)):
    e = await scoped(a, estate_id)
    await db.estates.update_one({"id": e["id"]}, {"$set": {"access_rules": body.model_dump(), "updated_at": now()}})
    await audit(a, "estate_rules_updated", "estate", e["id"], e["id"], body.model_dump())
    return {"ok": True, "access_rules": body.model_dump()}


class ResidentIn(Strict):
    estate_id: str
    full_name: str = Field(pattern=NAME)
    phone: str = Field(pattern=PHONE)
    email: EmailStr
    house_number: str = Field(pattern=HOUSE)
    password: str = Field(min_length=10, max_length=128)


@router.post("/residents", status_code=201)
async def create_resident(body: ResidentIn, a: dict = Depends(admin_only)):
    e = await scoped(a, body.estate_id)
    check_password_strength(body.password)
    if await find_account(body.email) or await find_account(body.phone):
        raise HTTPException(409, "Email or phone already registered")
    r = {"id": new_id(), "role": "resident", "estate_id": e["id"], "full_name": body.full_name,
         "display_name": display_name(body.full_name), "house_number": body.house_number.upper(),
         "phone_encrypted": enc(norm_phone(body.phone)), "phone_hash": phone_hash(body.phone),
         "email_encrypted": enc(norm_email(body.email)), "email_hash": email_hash(body.email),
         "password_hash": hash_password(body.password), "status": "active", "failed_logins": 0,
         "created_at": now(), "updated_at": now()}
    await db.residents.insert_one(r)
    await audit(a, "resident_created", "resident", r["id"], e["id"])
    return {"id": r["id"], "full_name": r["full_name"], "house_number": r["house_number"], "status": "active"}


@router.get("/residents")
async def list_residents(estate_id: Optional[str] = None, a: dict = Depends(admin_only)):
    e = await scoped(a, estate_id)
    docs = await db.residents.find({"estate_id": e["id"]}).sort("house_number", 1).to_list(1000)
    return [{"id": d["id"], "full_name": d["full_name"], "house_number": d["house_number"], "status": d["status"],
             "phone_masked": mask_phone(dec(d.get("phone_encrypted"))), "created_at": d["created_at"]} for d in docs]


class StatusIn(Strict):
    status: Literal["active", "suspended"]


@router.post("/residents/{resident_id}/status")
async def resident_status(resident_id: str, body: StatusIn, a: dict = Depends(admin_only)):
    r = await db.residents.find_one({"id": resident_id, "estate_id": {"$in": a.get("estate_ids", [])}})
    if not r:
        raise HTTPException(404, "Resident not found")
    await db.residents.update_one({"id": r["id"]}, {"$set": {"status": body.status, "updated_at": now()}})
    if body.status == "suspended":
        await revoke_families({"user_id": r["id"]})
    await audit(a, f"resident_{body.status}", "resident", r["id"], r["estate_id"])
    return {"ok": True}


class GuardIn(Strict):
    estate_id: str
    full_name: str = Field(pattern=NAME)
    phone: str = Field(pattern=PHONE)
    password: str = Field(min_length=10, max_length=128)


@router.post("/guards", status_code=201)
async def create_guard(body: GuardIn, a: dict = Depends(admin_only)):
    e = await scoped(a, body.estate_id)
    check_password_strength(body.password)
    if await find_account(body.phone):
        raise HTTPException(409, "Phone already registered")
    gd = {"id": new_id(), "role": "guard", "estate_id": e["id"], "full_name": body.full_name,
          "phone_encrypted": enc(norm_phone(body.phone)), "phone_hash": phone_hash(body.phone),
          "password_hash": hash_password(body.password), "status": "active", "device_id": None,
          "device_status": "unbound", "last_active_at": None, "failed_logins": 0, "created_at": now(), "updated_at": now()}
    await db.guards.insert_one(gd)
    await audit(a, "guard_created", "guard", gd["id"], e["id"])
    return {"id": gd["id"], "full_name": gd["full_name"], "device_status": "unbound"}


@router.get("/guards")
async def list_guards(estate_id: Optional[str] = None, a: dict = Depends(admin_only)):
    e = await scoped(a, estate_id)
    docs = await db.guards.find({"estate_id": e["id"]}).to_list(200)
    return [{"id": d["id"], "full_name": d["full_name"], "phone_masked": mask_phone(dec(d.get("phone_encrypted"))),
             "status": d["status"], "device_status": d.get("device_status"), "device_name": d.get("device_name"),
             "last_active_at": d.get("last_active_at"), "pending_sync_count": d.get("pending_sync_count", 0)} for d in docs]


class ReasonIn(Strict):
    reason: str = Field(min_length=10, max_length=300)


async def _guard(a: dict, guard_id: str) -> dict:
    gd = await db.guards.find_one({"id": guard_id, "estate_id": {"$in": a.get("estate_ids", [])}})
    if not gd:
        raise HTTPException(404, "Guard not found")
    return gd


@router.post("/devices/{guard_id}/revoke")
async def revoke_device(guard_id: str, body: ReasonIn, a: dict = Depends(admin_only)):
    """Remote revoke: kills all sessions; the device wipes its offline cache on the next 401/403."""
    gd = await _guard(a, guard_id)
    await db.guards.update_one({"id": gd["id"]}, {"$set": {"device_status": "revoked", "updated_at": now()}})
    await revoke_families({"user_id": gd["id"]})
    await audit(a, "guard_device_revoked", "guard", gd["id"], gd["estate_id"], {"reason": body.reason})
    return {"ok": True, "device_status": "revoked"}


@router.post("/devices/{guard_id}/reset")
async def reset_device(guard_id: str, body: ReasonIn, a: dict = Depends(admin_only)):
    gd = await _guard(a, guard_id)
    await db.guards.update_one({"id": gd["id"]}, {"$set": {"device_status": "unbound", "device_id": None, "updated_at": now()}})
    await revoke_families({"user_id": gd["id"]})
    await audit(a, "guard_device_reset", "guard", gd["id"], gd["estate_id"], {"reason": body.reason})
    return {"ok": True, "device_status": "unbound"}


class GateIn(Strict):
    estate_id: str
    name: str = Field(min_length=2, max_length=40)
    location: str = Field(default="", max_length=120)


@router.post("/gates", status_code=201)
async def create_gate(body: GateIn, a: dict = Depends(admin_only)):
    e = await scoped(a, body.estate_id)
    gate = {"id": new_id(), "estate_id": e["id"], "name": body.name, "location": body.location, "status": "active"}
    await db.gates.insert_one(gate)
    await audit(a, "gate_created", "gate", gate["id"], e["id"])
    return {k: gate[k] for k in ("id", "name", "location", "status")}


@router.get("/gates")
async def list_gates(estate_id: Optional[str] = None, a: dict = Depends(admin_only)):
    e = await scoped(a, estate_id)
    return [{k: g.get(k) for k in ("id", "name", "location", "status")} for g in await db.gates.find({"estate_id": e["id"]}).to_list(50)]


@router.get("/audit-logs")
async def audit_logs(estate_id: Optional[str] = None, limit: int = 100, a: dict = Depends(admin_only)):
    e = await scoped(a, estate_id)
    docs = await db.audit_logs.find({"$or": [{"estate_id": e["id"]}, {"actor_id": a["id"]}]}).sort("seq", -1).to_list(min(limit, 500))
    return [{k: d.get(k) for k in ("id", "seq", "actor_id", "actor_role", "action", "entity_type", "entity_id", "metadata", "created_at", "hash")} for d in docs]


@router.get("/audit-logs/verify")
async def verify_chain(a: dict = Depends(admin_only)):
    prev, count = "genesis", 0
    async for d in db.audit_logs.find({}).sort("seq", 1):
        entry = {k: v for k, v in d.items() if k not in ("_id", "hash", "prev_hash")}
        if d.get("prev_hash") != prev or sha256_hex(prev + json.dumps({k: str(v) for k, v in entry.items()}, sort_keys=True)) != d["hash"]:
            return {"valid": False, "broken_at_seq": d["seq"]}
        prev, count = d["hash"], count + 1
    return {"valid": True, "entries": count}


def _day_start(tz: str) -> datetime:
    local = datetime.now(ZoneInfo(tz)).replace(hour=0, minute=0, second=0, microsecond=0)
    return local.astimezone(timezone.utc)


@router.get("/overview")
async def overview(estate_id: Optional[str] = None, a: dict = Depends(admin_only)):
    e = await scoped(a, estate_id)
    await refresh_expired({"estate_id": e["id"]})
    start = _day_start(e["timezone"])
    guards = await db.guards.find({"estate_id": e["id"]}).to_list(200)
    return {
        "estate": estate_out(e),
        "residents": await db.residents.count_documents({"estate_id": e["id"], "status": "active"}),
        "pending_residents": await db.residents.count_documents({"estate_id": e["id"], "status": "pending"}),
        "active_passes": await db.visits.count_documents({"estate_id": e["id"], "status": "active"}),
        "entries_today": await db.scan_events.count_documents({"estate_id": e["id"], "decision": "admitted", "scanned_at": {"$gte": start}}),
        "denied_today": await db.scan_events.count_documents({"estate_id": e["id"], "result": {"$ne": "allowed"}, "scanned_at": {"$gte": start}}),
        "open_incidents": await db.incidents.count_documents({"estate_id": e["id"], "resolved": False}),
        "pending_syncs": sum(g.get("pending_sync_count", 0) for g in guards),
        "guards_active": len([g for g in guards if g.get("device_status") == "active"]),
    }


@router.get("/reports/visitor-traffic")
async def traffic(estate_id: Optional[str] = None, days: int = 7, a: dict = Depends(admin_only)):
    e = await scoped(a, estate_id)
    days = max(1, min(days, 31))
    tz = ZoneInfo(e["timezone"])
    start = _day_start(e["timezone"]) - timedelta(days=days - 1)
    events = await db.scan_events.find({"estate_id": e["id"], "scanned_at": {"$gte": start}}, {"scanned_at": 1, "result": 1, "decision": 1}).to_list(100000)
    buckets = {}
    for i in range(days):
        d = (start + timedelta(days=i)).astimezone(tz).strftime("%Y-%m-%d")
        buckets[d] = {"date": d, "entries": 0, "denied": 0, "scans": 0}
    for ev in events:
        d = ev["scanned_at"].astimezone(tz).strftime("%Y-%m-%d")
        if d in buckets:
            buckets[d]["scans"] += 1
            if ev.get("decision") == "admitted":
                buckets[d]["entries"] += 1
            if ev["result"] != "allowed":
                buckets[d]["denied"] += 1
    return list(buckets.values())


@router.get("/reports/security-incidents")
async def incidents(estate_id: Optional[str] = None, a: dict = Depends(admin_only)):
    e = await scoped(a, estate_id)
    docs = await db.incidents.find({"estate_id": e["id"]}).sort("created_at", -1).to_list(200)
    gates = {g["id"]: g["name"] for g in await db.gates.find({"estate_id": e["id"]}).to_list(50)}
    guards = {g["id"]: g["full_name"] for g in await db.guards.find({"estate_id": e["id"]}).to_list(200)}
    return [{"id": d["id"], "type": d["type"], "details": d.get("details"), "gate": gates.get(d.get("gate_id")),
             "guard": guards.get(d.get("guard_id")), "resolved": d["resolved"], "created_at": d["created_at"]} for d in docs]


@router.post("/incidents/{incident_id}/resolve")
async def resolve_incident(incident_id: str, a: dict = Depends(admin_only)):
    res = await db.incidents.update_one({"id": incident_id, "estate_id": {"$in": a.get("estate_ids", [])}},
                                        {"$set": {"resolved": True, "resolved_by": a["id"], "resolved_at": now()}})
    if not res.matched_count:
        raise HTTPException(404, "Incident not found")
    await audit(a, "incident_resolved", "incident", incident_id)
    return {"ok": True}


@router.get("/visits")
async def list_visits(estate_id: Optional[str] = None, a: dict = Depends(admin_only)):
    """Masked list: first name + initial only. Full details require /reveal with a logged reason."""
    e = await scoped(a, estate_id)
    visits = await db.visits.find({"estate_id": e["id"]}).sort("valid_from", -1).to_list(200)
    vmap = await visitors_by_id([v["visitor_id"] for v in visits])

    def masked(n):
        p = (n or "Visitor").split()
        return p[0] + (f" {p[-1][0]}." if len(p) > 1 else "")
    return [{"id": v["id"], "ref_code": v["ref_code"], "visitor": masked(v.get("visitor_name") or (vmap.get(v["visitor_id"]) or {}).get("full_name")),
             "house_number": v["house_number"], "pass_type": v["pass_type"], "status": v["status"],
             "valid_from": v["valid_from"], "valid_to": v["valid_to"], "scan_count": v["scan_count"], "max_scans": v["max_scans"]} for v in visits]


@router.post("/visits/{visit_id}/reveal")
async def reveal(visit_id: str, body: ReasonIn, request: Request, a: dict = Depends(admin_only)):
    v = await db.visits.find_one({"id": visit_id, "estate_id": {"$in": a.get("estate_ids", [])}})
    if not v:
        raise HTTPException(404, "Visit not found")
    visitor = await db.visitors.find_one({"id": v["visitor_id"]}) or {}
    await audit(a, "pii_revealed", "visit", v["id"], v["estate_id"], {"reason": body.reason}, request)
    return {"visitor_name": v.get("visitor_name") or visitor.get("full_name"), "visitor_phone": dec(visitor.get("phone_encrypted")),
            "vehicle_plate": dec(v.get("vehicle_plate_encrypted")), "purpose": v.get("purpose")}


@router.post("/retention/run")
async def retention_run(estate_id: Optional[str] = None, a: dict = Depends(admin_only)):
    e = await scoped(a, estate_id)
    summary = await run_retention(e)
    await audit(a, "retention_job_triggered", "estate", e["id"], e["id"], summary)
    return summary


@router.get("/privacy-requests")
async def privacy_requests(estate_id: Optional[str] = None, a: dict = Depends(admin_only)):
    e = await scoped(a, estate_id)
    docs = await db.privacy_requests.find({"estate_id": e["id"]}).sort("created_at", -1).to_list(200)
    await audit(a, "privacy_requests_viewed", "estate", e["id"], e["id"])
    return [{"id": d["id"], "type": d["type"], "contact": dec(d["contact_encrypted"]), "details": d.get("details"),
             "status": d["status"], "created_at": d["created_at"]} for d in docs]


class PrivacyStatusIn(Strict):
    status: Literal["in_progress", "completed", "rejected"]


@router.post("/privacy-requests/{req_id}/status")
async def privacy_status(req_id: str, body: PrivacyStatusIn, a: dict = Depends(admin_only)):
    res = await db.privacy_requests.update_one({"id": req_id, "estate_id": {"$in": a.get("estate_ids", [])}},
                                               {"$set": {"status": body.status, "updated_at": now()}})
    if not res.matched_count:
        raise HTTPException(404, "Request not found")
    await audit(a, "privacy_request_updated", "privacy_request", req_id, None, {"status": body.status})
    return {"ok": True}
