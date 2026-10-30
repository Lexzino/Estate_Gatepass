from datetime import datetime, timedelta
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field

from core import (audit, db, enc, new_id, norm_phone, now, phone_hash, public_keys, rate_limit, require_role,
                  sha256_hex, verify_pass)
from passes import RESULT_TO_EVENT, evaluate
from push import notify_residents
from routes_auth import HOUSE, NAME, PHONE, Strict
from services import (get_estate, guard_response, household_resident_ids, record_incident, refresh_expired,
                      to_utc, visitors_by_id)

router = APIRouter(prefix="/api/guard", tags=["guard"])
guard_only = require_role("guard")
REF = r"^EG-[A-Z0-9]{4}-[A-Z0-9]{4}$"


async def own_gate(g: dict, gate_id: str) -> dict:
    gate = await db.gates.find_one({"id": gate_id, "estate_id": g["estate_id"]})
    if not gate or gate.get("status") != "active":
        raise HTTPException(422, "Unknown or inactive gate")
    return gate


async def scan_event(g: dict, gate_id: str, visit: Optional[dict], result: str, notes: Optional[str],
                     offline: bool = False, scanned_at: datetime = None, **extra) -> dict:
    ev = {"id": new_id(), "visit_id": visit["id"] if visit else None, "estate_id": g["estate_id"],
          "guard_id": g["id"], "gate_id": gate_id, "device_id": g.get("_device_id"),
          "scanned_at": scanned_at or now(), "result": result, "offline_created": offline,
          "synced_at": now() if offline else None, "notes": notes, "decision": None, "exit_at": None, **extra}
    await db.scan_events.insert_one(ev)
    return ev


@router.get("/me")
async def me(g: dict = Depends(guard_only)):
    estate = await get_estate(g["estate_id"])
    gates = await db.gates.find({"estate_id": g["estate_id"], "status": "active"}).to_list(20)
    return {"id": g["id"], "full_name": g["full_name"], "device_status": g.get("device_status"),
            "estate": {"id": estate["id"], "name": estate["name"], "code": estate["code"], "timezone": estate["timezone"]},
            "gates": [{"id": x["id"], "name": x["name"], "location": x.get("location")} for x in gates]}


class ScanIn(Strict):
    token: Optional[str] = Field(default=None, min_length=10, max_length=600)
    ref: Optional[str] = Field(default=None, pattern=REF)
    gate_id: str = Field(min_length=8, max_length=64)


async def _deny_unknown(g: dict, gate_id: str, reason: str) -> dict:
    ev = await scan_event(g, gate_id, None, "denied", reason)
    recent = await db.scan_events.count_documents({"guard_id": g["id"], "visit_id": None, "result": "denied",
                                                   "scanned_at": {"$gt": now() - timedelta(minutes=10)}})
    if recent == 5:
        await record_incident(g["estate_id"], "TOKEN_GUESSING", g["id"], gate_id, None,
                              "5 invalid passes scanned within 10 minutes")
    return {"result": "DENIED", "reason": reason, "scan_id": ev["id"]}


@router.post("/scan")
async def scan(body: ScanIn, g: dict = Depends(guard_only)):
    rate_limit(f"scan:{g['id']}", 40, 60)
    if not body.token and not body.ref:
        raise HTTPException(422, "Provide a QR token or pass reference")
    await own_gate(g, body.gate_id)
    estate = await get_estate(g["estate_id"])
    if body.token:
        payload = verify_pass(body.token)
        if not payload:
            return await _deny_unknown(g, body.gate_id, "INVALID_SIGNATURE")
        if payload.get("ec") != estate["code"]:
            return await _deny_unknown(g, body.gate_id, "WRONG_ESTATE")
        visit = await db.visits.find_one({"pass_token_hash": sha256_hex(body.token)})
    else:
        visit = await db.visits.find_one({"ref_code": body.ref, "estate_id": g["estate_id"]})
    if not visit:
        return await _deny_unknown(g, body.gate_id, "UNKNOWN_PASS")
    if visit["estate_id"] != g["estate_id"]:
        return await _deny_unknown(g, body.gate_id, "WRONG_ESTATE")
    result, reason = evaluate(visit, now(), estate["timezone"], body.gate_id)
    ev = await scan_event(g, body.gate_id, visit, RESULT_TO_EVENT[result], reason,
                          method="qr" if body.token else "reference")
    incident = {"ALREADY_USED": "DUPLICATE_SCAN", "EXPIRED": "EXPIRED_PASS_ATTEMPT", "REVOKED": "REVOKED_PASS_ATTEMPT"}.get(result)
    if incident:
        await record_incident(g["estate_id"], incident, g["id"], body.gate_id, visit["id"], reason or "")
    return await guard_response(visit, result, reason, ev["id"], estate["timezone"])


class ConfirmIn(Strict):
    scan_id: str = Field(min_length=8, max_length=64)
    decision: Literal["admit", "refuse"]
    identity_confirmed: bool = False


async def _consume_entry(visit_id: str) -> Optional[dict]:
    v = await db.visits.find_one_and_update(
        {"id": visit_id, "status": "active", "$expr": {"$lt": ["$scan_count", "$max_scans"]}},
        {"$inc": {"scan_count": 1}, "$set": {"last_entry_at": now(), "updated_at": now()}}, return_document=True)
    if v and v["scan_count"] >= v["max_scans"]:
        await db.visits.update_one({"id": v["id"]}, {"$set": {"status": "used"}})
        v["status"] = "used"
    return v


async def _notify_check_in(v: dict, gate_name: str):
    visitor = await db.visitors.find_one({"id": v["visitor_id"]})
    name = v.get("visitor_name") or (visitor["full_name"] if visitor else "Your visitor")
    rids = await household_resident_ids(v["estate_id"], v["house_number"])
    await notify_residents(rids, "check_in", "Visitor checked in", f"{name} entered through {gate_name}.",
                           {"visit_id": v["id"]}, action_url=f"/resident/pass/{v['id']}")


@router.post("/entry-confirm")
async def entry_confirm(body: ConfirmIn, g: dict = Depends(guard_only)):
    ev = await db.scan_events.find_one({"id": body.scan_id, "guard_id": g["id"]})
    if not ev:
        raise HTTPException(404, "Scan not found")
    if ev.get("decision"):
        raise HTTPException(409, "Decision already recorded")
    if body.decision == "refuse":
        await db.scan_events.update_one({"id": ev["id"]}, {"$set": {"decision": "refused"}})
        return {"result": "REFUSED"}
    if ev["result"] != "allowed":
        raise HTTPException(409, "Only an ALLOW result can be admitted")
    if not body.identity_confirmed:
        raise HTTPException(422, "Confirm the visitor's identity before admitting")
    v = await _consume_entry(ev["visit_id"])
    if not v:
        await db.scan_events.update_one({"id": ev["id"]}, {"$set": {"result": "needs_review", "notes": "RACE_ALREADY_USED"}})
        await record_incident(g["estate_id"], "DUPLICATE_SCAN", g["id"], ev["gate_id"], ev["visit_id"], "Pass consumed concurrently")
        return {"result": "ALREADY_USED"}
    await db.scan_events.update_one({"id": ev["id"]}, {"$set": {"decision": "admitted", "entry_at": now()}})
    gate = await db.gates.find_one({"id": ev["gate_id"]})
    await _notify_check_in(v, gate["name"] if gate else "the gate")
    await audit(g, "entry_admitted", "visit", v["id"], g["estate_id"], {"scan_id": ev["id"]})
    return {"result": "ADMITTED", "remaining_entries": max(0, v["max_scans"] - v["scan_count"])}


class ExitIn(Strict):
    scan_id: str = Field(min_length=8, max_length=64)


@router.post("/exit-event")
async def exit_event(body: ExitIn, g: dict = Depends(guard_only)):
    ev = await db.scan_events.find_one({"id": body.scan_id, "estate_id": g["estate_id"], "decision": "admitted"})
    if not ev:
        raise HTTPException(404, "Entry not found")
    if ev.get("exit_at"):
        raise HTTPException(409, "Exit already logged")
    await db.scan_events.update_one({"id": ev["id"]}, {"$set": {"exit_at": now(), "exit_guard_id": g["id"]}})
    await audit(g, "exit_logged", "scan_event", ev["id"], g["estate_id"])
    return {"ok": True}


@router.get("/offline-passes")
async def offline_passes(pending: int = 0, g: dict = Depends(guard_only)):
    estate = await get_estate(g["estate_id"])
    hours = min(72, max(24, (estate.get("access_rules") or {}).get("offline_cache_hours", 48)))
    await refresh_expired({"estate_id": g["estate_id"]})
    horizon = now() + timedelta(hours=hours)
    visits = await db.visits.find({"estate_id": g["estate_id"], "status": "active", "valid_to": {"$gt": now()},
                                   "valid_from": {"$lt": horizon}}).to_list(5000)
    vmap = await visitors_by_id([v["visitor_id"] for v in visits])
    res = {r["id"]: r for r in await db.residents.find({"estate_id": g["estate_id"]}, {"id": 1, "display_name": 1}).to_list(5000)}
    await db.guards.update_one({"id": g["id"]}, {"$set": {"pending_sync_count": max(0, pending), "last_cache_sync_at": now()}})
    await audit(g, "offline_cache_issued", "guard", g["id"], g["estate_id"], {"passes": len(visits)})
    return {
        "estate_id": estate["id"], "estate_code": estate["code"], "timezone": estate["timezone"],
        "public_keys": public_keys(), "generated_at": now(), "expires_at": horizon,
        "passes": [{
            "h": v["pass_token_hash"], "vn": v.get("visitor_name") or (vmap.get(v["visitor_id"]) or {}).get("full_name", "Visitor"),
            "hn": (res.get(v["resident_id"]) or {}).get("display_name", "Resident"), "house": v["house_number"],
            "f": v["valid_from"], "t": v["valid_to"], "max": v["max_scans"], "count": v["scan_count"],
            "type": v["pass_type"], "gates": v.get("allowed_gate_ids") or [], "sch": v.get("schedule"),
        } for v in visits],
    }


class OfflineItem(Strict):
    local_id: str = Field(pattern=r"^[A-Za-z0-9\-]{8,64}$")
    token_hash: Optional[str] = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    gate_id: str = Field(min_length=8, max_length=64)
    scanned_at: datetime
    local_result: Literal["ALLOW", "DENIED", "EXPIRED", "REVOKED", "ALREADY_USED", "NEEDS_REVIEW"]
    local_reason: Optional[str] = Field(default=None, max_length=40)
    admitted: bool = False
    identity_confirmed: bool = False


class OfflineSyncIn(Strict):
    items: list[OfflineItem] = Field(max_length=500)


@router.post("/scan/offline-sync")
async def offline_sync(body: OfflineSyncIn, g: dict = Depends(guard_only)):
    rate_limit(f"sync:{g['id']}", 20, 60)
    gate_names = {x["id"]: x["name"] for x in await db.gates.find({"estate_id": g["estate_id"]}).to_list(20)}
    out, flagged = [], 0
    for it in body.items:
        if await db.scan_events.find_one({"device_id": g.get("_device_id"), "local_id": it.local_id}):
            out.append({"local_id": it.local_id, "status": "already_synced"})
            continue
        if it.gate_id not in gate_names:
            out.append({"local_id": it.local_id, "status": "rejected_gate"})
            continue
        visit = await db.visits.find_one({"pass_token_hash": it.token_hash, "estate_id": g["estate_id"]}) if it.token_hash else None
        result, notes, decision = RESULT_TO_EVENT[it.local_result], it.local_reason, None
        if it.admitted:
            consumed = await _consume_entry(visit["id"]) if visit and it.identity_confirmed else None
            if consumed:
                decision = "admitted"
                await _notify_check_in(consumed, gate_names[it.gate_id])
            else:
                result, notes, decision = "needs_review", "DUPLICATE_OFFLINE_ENTRY" if visit else "UNKNOWN_PASS_OFFLINE", "admitted"
                flagged += 1
                await record_incident(g["estate_id"], "OFFLINE_DUPLICATE" if visit else "OFFLINE_UNKNOWN_PASS", g["id"],
                                      it.gate_id, visit["id"] if visit else None, "Admitted offline; server could not reconcile")
        elif it.local_result == "ALREADY_USED" and visit:
            await record_incident(g["estate_id"], "DUPLICATE_SCAN", g["id"], it.gate_id, visit["id"], "Offline duplicate scan")
        await scan_event(g, it.gate_id, visit, result, notes, offline=True, scanned_at=to_utc(it.scanned_at),
                         local_id=it.local_id, decision=decision, entry_at=to_utc(it.scanned_at) if decision == "admitted" else None)
        out.append({"local_id": it.local_id, "status": "flagged" if result == "needs_review" and it.admitted else "synced"})
    await db.guards.update_one({"id": g["id"]}, {"$set": {"pending_sync_count": 0}})
    await audit(g, "offline_sync", "guard", g["id"], g["estate_id"], {"items": len(body.items), "flagged": flagged})
    return {"synced": len([o for o in out if o["status"] in ("synced", "flagged")]), "flagged": flagged, "results": out}


@router.get("/scan-history")
async def scan_history(g: dict = Depends(guard_only)):
    events = await db.scan_events.find({"guard_id": g["id"], "scanned_at": {"$gt": now() - timedelta(hours=24)}}).sort("scanned_at", -1).to_list(100)
    visits = {v["id"]: v for v in await db.visits.find({"id": {"$in": [e["visit_id"] for e in events if e.get("visit_id")]}}).to_list(100)}
    vmap = await visitors_by_id([v["visitor_id"] for v in visits.values()])
    gates = {x["id"]: x["name"] for x in await db.gates.find({"estate_id": g["estate_id"]}).to_list(20)}
    out = []
    for e in events:
        v = visits.get(e.get("visit_id"))
        out.append({"id": e["id"], "scanned_at": e["scanned_at"], "result": e["result"], "notes": e.get("notes"),
                    "decision": e.get("decision"), "exit_at": e.get("exit_at"), "offline": e.get("offline_created", False),
                    "gate": gates.get(e.get("gate_id"), "Gate"),
                    "visitor_name": (v.get("visitor_name") or (vmap.get(v["visitor_id"]) or {}).get("full_name")) if v else None,
                    "house_number": v["house_number"] if v else None})
    return out


class LookupIn(Strict):
    phone: Optional[str] = Field(default=None, pattern=PHONE)
    ref: Optional[str] = Field(default=None, pattern=REF)


@router.post("/manual-lookup")
async def manual_lookup(body: LookupIn, g: dict = Depends(guard_only)):
    rate_limit(f"lookup:{g['id']}", 10, 60)
    if not body.phone and not body.ref:
        raise HTTPException(422, "Enter a phone number or pass reference")
    await refresh_expired({"estate_id": g["estate_id"]})
    q = {"estate_id": g["estate_id"], "status": {"$in": ["active", "pending"]}}
    if body.ref:
        q = {"estate_id": g["estate_id"], "ref_code": body.ref}  # any status, so the guard sees EXPIRED/USED on verify
    else:
        vis = await db.visitors.find_one({"phone_hash": phone_hash(body.phone)})
        if not vis:
            await audit(g, "manual_lookup", "guard", g["id"], g["estate_id"], {"method": "phone", "matches": 0})
            return []
        q["visitor_id"] = vis["id"]
    visits = await db.visits.find(q).sort("valid_from", 1).to_list(10)
    vmap = await visitors_by_id([v["visitor_id"] for v in visits])
    res = {r["id"]: r.get("display_name") for r in await db.residents.find({"id": {"$in": [v["resident_id"] for v in visits]}}).to_list(10)}
    await audit(g, "manual_lookup", "guard", g["id"], g["estate_id"], {"method": "ref" if body.ref else "phone", "matches": len(visits)})
    return [{"ref_code": v["ref_code"], "visitor_name": v.get("visitor_name") or (vmap.get(v["visitor_id"]) or {}).get("full_name"),
             "host_name": res.get(v["resident_id"]), "house_number": v["house_number"], "pass_type": v["pass_type"],
             "valid_from": v["valid_from"], "valid_to": v["valid_to"], "status": v["status"]} for v in visits]


class OverrideIn(Strict):
    visitor_name: str = Field(pattern=NAME)
    visitor_phone: str = Field(pattern=PHONE)
    house_number: str = Field(pattern=HOUSE)
    purpose: Optional[str] = Field(default=None, max_length=120)
    vehicle_plate: Optional[str] = Field(default=None, pattern=r"^[A-Za-z0-9\- ]{2,12}$")
    gate_id: str = Field(min_length=8, max_length=64)


@router.post("/manual-override", status_code=201)
async def manual_override(body: OverrideIn, g: dict = Depends(guard_only)):
    """Unexpected visitor: ask the household to approve. A pass is only created after a resident approves."""
    rate_limit(f"override:{g['id']}", 15, 600)
    await own_gate(g, body.gate_id)
    house = body.house_number.upper()
    rids = await household_resident_ids(g["estate_id"], house)
    if not rids:
        raise HTTPException(404, "No active resident at that house")
    req = {"id": new_id(), "estate_id": g["estate_id"], "house_number": house, "guard_id": g["id"], "gate_id": body.gate_id,
           "visitor_name": body.visitor_name, "visitor_phone_encrypted": enc(norm_phone(body.visitor_phone)),
           "visitor_phone_hash": phone_hash(body.visitor_phone), "purpose": body.purpose,
           "vehicle_plate_encrypted": enc(body.vehicle_plate.upper()) if body.vehicle_plate else None,
           "status": "pending", "visit_id": None, "created_at": now()}
    await db.visitor_requests.insert_one(req)
    await notify_residents(rids, "visitor_request", "Visitor at the gate",
                           f"{body.visitor_name} is asking to visit. Tap to approve or reject.",
                           {"request_id": req["id"]}, action_url="/resident")
    await audit(g, "visitor_request_created", "visitor_request", req["id"], g["estate_id"])
    return {"id": req["id"], "status": "pending", "house_number": house}


@router.get("/visitor-requests")
async def my_requests(g: dict = Depends(guard_only)):
    await db.visitor_requests.update_many({"status": "pending", "created_at": {"$lt": now() - timedelta(minutes=30)}},
                                          {"$set": {"status": "expired"}})
    docs = await db.visitor_requests.find({"guard_id": g["id"], "created_at": {"$gt": now() - timedelta(hours=12)}}).sort("created_at", -1).to_list(50)
    refs = {v["id"]: v["ref_code"] for v in await db.visits.find({"id": {"$in": [d["visit_id"] for d in docs if d.get("visit_id")]}}).to_list(50)}
    return [{"id": d["id"], "visitor_name": d["visitor_name"], "house_number": d["house_number"], "status": d["status"],
             "ref_code": refs.get(d.get("visit_id")), "created_at": d["created_at"]} for d in docs]
