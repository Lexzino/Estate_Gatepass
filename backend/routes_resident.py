from datetime import datetime, timedelta
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field

from core import audit, db, dec, mask_phone, now, rate_limit, require_role
from passes import PASS_TYPES, VISIT_TYPES, validate_window
from push import notify_residents  # noqa: F401  (kept for parity with guard flows)
from routes_auth import NAME, PHONE, Strict
from services import (create_visit, get_estate, refresh_expired, reissue_token, resident_view, to_utc,
                      visitors_by_id)

router = APIRouter(prefix="/api/residents", tags=["resident"])
resident_only = require_role("resident")


def household(r: dict) -> dict:
    return {"estate_id": r["estate_id"], "house_number": r["house_number"]}


class ScheduleIn(Strict):
    days: list[int] = Field(min_length=1, max_length=7)
    start: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    end: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")


class CreateVisitIn(Strict):
    visitor_name: str = Field(pattern=NAME)
    visitor_phone: str = Field(pattern=PHONE)
    visit_type: Literal[VISIT_TYPES]  # type: ignore[valid-type]
    pass_type: Literal[PASS_TYPES]  # type: ignore[valid-type]
    valid_from: datetime
    valid_to: datetime
    max_scans: int = Field(default=1, ge=1, le=50)
    vehicle_plate: Optional[str] = Field(default=None, pattern=r"^[A-Za-z0-9\- ]{2,12}$")
    purpose: Optional[str] = Field(default=None, max_length=120)
    schedule: Optional[ScheduleIn] = None
    allowed_gate_ids: Optional[list[str]] = Field(default=None, max_length=5)


async def own_visit(r: dict, visit_id: str) -> dict:
    v = await db.visits.find_one({"id": visit_id, **household(r)})
    if not v:
        raise HTTPException(404, "Pass not found")  # same answer for other households (no IDOR oracle)
    return v


@router.get("/me")
async def me(r: dict = Depends(resident_only)):
    estate = await get_estate(r["estate_id"])
    return {"id": r["id"], "full_name": r["full_name"], "house_number": r["house_number"],
            "phone_masked": mask_phone(dec(r.get("phone_encrypted"))), "email": dec(r.get("email_encrypted")),
            "estate": {"id": estate["id"], "name": estate["name"], "code": estate["code"], "timezone": estate["timezone"]}}


@router.post("/visits", status_code=201)
async def create(body: CreateVisitIn, r: dict = Depends(resident_only)):
    rate_limit(f"visit-create:{r['id']}", 30, 3600)
    estate = await get_estate(r["estate_id"])
    vf, vt = to_utc(body.valid_from), to_utc(body.valid_to)
    if vf < now():
        vf = now()
    err = validate_window(body.pass_type, vf, vt, now())
    if err:
        raise HTTPException(422, err)
    if body.pass_type == "recurring" and not body.schedule:
        raise HTTPException(422, "Recurring passes need days and hours")
    if body.schedule and any(d < 0 or d > 6 for d in body.schedule.days):
        raise HTTPException(422, "Invalid schedule days")
    if body.allowed_gate_ids:
        count = await db.gates.count_documents({"id": {"$in": body.allowed_gate_ids}, "estate_id": estate["id"]})
        if count != len(set(body.allowed_gate_ids)):
            raise HTTPException(422, "Unknown gate")
    visit, token = await create_visit(
        estate, r, visitor_name=body.visitor_name, visitor_phone=body.visitor_phone, pass_type=body.pass_type,
        visit_type=body.visit_type, valid_from=vf, valid_to=vt, max_scans=body.max_scans,
        vehicle_plate=body.vehicle_plate, purpose=body.purpose,
        schedule=body.schedule.model_dump() if body.schedule else None,
        allowed_gate_ids=body.allowed_gate_ids, created_by=r)
    visitor = (await visitors_by_id([visit["visitor_id"]])).get(visit["visitor_id"])
    return {"visit": resident_view(visit, visitor), "token": token, "estate_name": estate["name"]}


@router.get("/visits")
async def list_visits(status: Optional[str] = None, r: dict = Depends(resident_only)):
    await refresh_expired(household(r))
    q = household(r)
    if status:
        if status not in ("pending", "active", "used", "expired", "revoked"):
            raise HTTPException(422, "Invalid status")
        q["status"] = status
    visits = await db.visits.find(q).sort("valid_from", -1).to_list(200)
    vmap = await visitors_by_id([v["visitor_id"] for v in visits])
    return [resident_view(v, vmap.get(v["visitor_id"])) for v in visits]


@router.get("/visits/{visit_id}")
async def get_visit(visit_id: str, r: dict = Depends(resident_only)):
    await refresh_expired(household(r))
    v = await own_visit(r, visit_id)
    visitor = (await visitors_by_id([v["visitor_id"]])).get(v["visitor_id"])
    events = await db.scan_events.find({"visit_id": v["id"]}).sort("scanned_at", -1).to_list(50)
    gates = {g["id"]: g["name"] for g in await db.gates.find({"estate_id": r["estate_id"]}).to_list(50)}
    return {**resident_view(v, visitor), "events": [
        {"id": e["id"], "scanned_at": e["scanned_at"], "result": e["result"], "decision": e.get("decision"),
         "gate": gates.get(e.get("gate_id"), "Gate"), "exit_at": e.get("exit_at"), "offline": e.get("offline_created", False)}
        for e in events]}


@router.post("/visits/{visit_id}/revoke")
async def revoke(visit_id: str, r: dict = Depends(resident_only)):
    v = await own_visit(r, visit_id)
    if v["status"] not in ("active", "pending"):
        raise HTTPException(409, f"Pass is already {v['status']}")
    await db.visits.update_one({"id": v["id"]}, {"$set": {"status": "revoked", "revoked_at": now(), "updated_at": now()}})
    await audit(r, "visit_revoked", "visit", v["id"], r["estate_id"])
    return {"ok": True, "status": "revoked"}


@router.post("/visits/{visit_id}/reissue")
async def reissue(visit_id: str, r: dict = Depends(resident_only)):
    """QR tokens are never stored. Reissuing invalidates the old QR and returns a new one."""
    await refresh_expired(household(r))
    v = await own_visit(r, visit_id)
    if v["status"] not in ("active", "pending"):
        raise HTTPException(409, f"Pass is {v['status']} and cannot be reissued")
    token = await reissue_token(v, await get_estate(r["estate_id"]))
    await audit(r, "visit_reissued", "visit", v["id"], r["estate_id"])
    return {"token": token}


@router.get("/notifications")
async def notifications(r: dict = Depends(resident_only)):
    docs = await db.notifications.find({"resident_id": r["id"]}).sort("created_at", -1).to_list(100)
    return [{k: d[k] for k in ("id", "kind", "title", "message", "ref", "read", "created_at")} for d in docs]


@router.post("/notifications/read-all")
async def read_all(r: dict = Depends(resident_only)):
    await db.notifications.update_many({"resident_id": r["id"], "read": False}, {"$set": {"read": True}})
    return {"ok": True}


async def _expire_requests():
    await db.visitor_requests.update_many({"status": "pending", "created_at": {"$lt": now() - timedelta(minutes=30)}},
                                          {"$set": {"status": "expired"}})


@router.get("/visitor-requests")
async def visitor_requests(r: dict = Depends(resident_only)):
    await _expire_requests()
    docs = await db.visitor_requests.find(household(r)).sort("created_at", -1).to_list(50)
    gates = {g["id"]: g["name"] for g in await db.gates.find({"estate_id": r["estate_id"]}).to_list(50)}
    return [{"id": d["id"], "visitor_name": d["visitor_name"], "visitor_phone_masked": mask_phone(dec(d.get("visitor_phone_encrypted"))),
             "purpose": d.get("purpose"), "vehicle_plate": dec(d.get("vehicle_plate_encrypted")),
             "gate": gates.get(d.get("gate_id"), "Gate"), "status": d["status"], "created_at": d["created_at"]} for d in docs]


async def _resolve_request_alerts(request_id: str, message: str):
    await db.notifications.update_many({"ref.request_id": request_id}, {"$set": {"message": message, "title": "Gate request handled"}})


async def _pending_request(r: dict, request_id: str) -> dict:
    await _expire_requests()
    req = await db.visitor_requests.find_one({"id": request_id, **household(r)})
    if not req:
        raise HTTPException(404, "Request not found")
    # Atomic claim so two household members deciding at once can't both act
    claimed = await db.visitor_requests.find_one_and_update(
        {"id": req["id"], "status": "pending"}, {"$set": {"status": "processing"}})
    if not claimed:
        raise HTTPException(409, f"Request already {req['status'] if req['status'] != 'pending' else 'handled'}")
    return req


@router.post("/visitor-requests/{request_id}/approve")
async def approve(request_id: str, r: dict = Depends(resident_only)):
    req = await _pending_request(r, request_id)
    estate = await get_estate(r["estate_id"])
    hours = (estate.get("access_rules") or {}).get("walk_in_pass_minutes", 60)
    visit, _token = await create_visit(
        estate, r, visitor_name=req["visitor_name"], visitor_phone=dec(req["visitor_phone_encrypted"]),
        pass_type="one_time", visit_type="other", valid_from=now(), valid_to=now() + timedelta(minutes=hours),
        max_scans=1, vehicle_plate=dec(req.get("vehicle_plate_encrypted")), purpose=req.get("purpose"),
        schedule=None, allowed_gate_ids=[req["gate_id"]] if req.get("gate_id") else None, created_by=r)
    await _resolve_request_alerts(req["id"], f"Approved by {r['display_name']} — the guard can admit {req['visitor_name']}.")
    await db.visitor_requests.update_one({"id": req["id"]}, {"$set": {
        "status": "approved", "visit_id": visit["id"], "decided_by": r["id"], "decided_at": now()}})
    await audit(r, "visitor_request_approved", "visitor_request", req["id"], r["estate_id"])
    return {"ok": True, "status": "approved", "ref_code": visit["ref_code"]}


@router.post("/visitor-requests/{request_id}/reject")
async def reject(request_id: str, r: dict = Depends(resident_only)):
    req = await _pending_request(r, request_id)
    await _resolve_request_alerts(req["id"], f"Rejected by {r['display_name']}.")
    await db.visitor_requests.update_one({"id": req["id"]}, {"$set": {"status": "rejected", "decided_by": r["id"], "decided_at": now()}})
    await audit(r, "visitor_request_rejected", "visitor_request", req["id"], r["estate_id"])
    return {"ok": True, "status": "rejected"}
