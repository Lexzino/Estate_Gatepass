"""Domain services shared by routers: visits, visitors, guard responses, jobs."""
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import HTTPException

from core import audit, db, dec, enc, mask_phone, new_id, norm_phone, now, phone_hash, sha256_hex, sign_pass

REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def gen_ref() -> str:
    pick = lambda n: "".join(secrets.choice(REF_ALPHABET) for _ in range(n))  # noqa: E731
    return f"EG-{pick(4)}-{pick(4)}"


def display_name(full_name: str) -> str:
    parts = full_name.split()
    return f"{parts[0][0]}. {parts[-1]}" if len(parts) > 1 else full_name


async def get_estate(estate_id: str) -> dict:
    estate = await db.estates.find_one({"id": estate_id})
    if not estate:
        raise HTTPException(404, "Estate not found")
    return estate


async def upsert_visitor(full_name: str, phone: str) -> dict:
    h = phone_hash(phone)
    existing = await db.visitors.find_one({"phone_hash": h})
    if existing:
        return existing  # name is snapshotted per visit, never overwritten across households
    doc = {"id": new_id(), "full_name": full_name, "phone_encrypted": enc(norm_phone(phone)), "phone_hash": h,
           "photo_url": None, "created_at": now(), "updated_at": now()}
    await db.visitors.insert_one(doc)
    return doc


async def create_visit(estate: dict, resident: dict, *, visitor_name: str, visitor_phone: str, pass_type: str,
                       visit_type: str, valid_from: datetime, valid_to: datetime, max_scans: int,
                       vehicle_plate: Optional[str], purpose: Optional[str], schedule: Optional[dict],
                       allowed_gate_ids: Optional[list], created_by: dict) -> tuple[dict, str]:
    visitor = await upsert_visitor(visitor_name, visitor_phone)
    token, signature, nonce = sign_pass(estate["code"], valid_from, valid_to)
    visit = {
        "id": new_id(), "ref_code": gen_ref(), "estate_id": estate["id"], "resident_id": resident["id"],
        "house_number": resident["house_number"], "visitor_id": visitor["id"], "visitor_name": visitor_name,
        "pass_token_hash": sha256_hex(token), "pass_signature": signature, "nonce": nonce,
        "pass_type": pass_type, "visit_type": visit_type, "valid_from": valid_from, "valid_to": valid_to,
        "max_scans": 1 if pass_type == "one_time" else max_scans, "scan_count": 0,
        "vehicle_plate_encrypted": enc(vehicle_plate.upper().strip()) if vehicle_plate else None,
        "purpose": purpose, "schedule": schedule, "allowed_gate_ids": allowed_gate_ids or [],
        "status": "active", "created_by": created_by["id"], "created_by_role": created_by["role"],
        "created_at": now(), "updated_at": now(), "last_entry_at": None,
    }
    await db.visits.insert_one(visit)
    await audit(created_by, "visit_created", "visit", visit["id"], estate["id"], {"pass_type": pass_type})
    return visit, token


async def reissue_token(visit: dict, estate: dict) -> str:
    token, signature, nonce = sign_pass(estate["code"], visit["valid_from"], visit["valid_to"])
    await db.visits.update_one({"id": visit["id"]}, {"$set": {
        "pass_token_hash": sha256_hex(token), "pass_signature": signature, "nonce": nonce, "updated_at": now()}})
    return token


async def refresh_expired(query: Optional[dict] = None):
    await db.visits.update_many({**(query or {}), "status": {"$in": ["active", "pending"]}, "valid_to": {"$lt": now()}},
                                {"$set": {"status": "expired", "updated_at": now()}})


async def visitors_by_id(ids: list[str]) -> dict:
    docs = await db.visitors.find({"id": {"$in": list(set(ids))}}).to_list(1000)
    return {d["id"]: d for d in docs}


def resident_view(v: dict, visitor: Optional[dict]) -> dict:
    return {
        "id": v["id"], "ref_code": v["ref_code"],
        "visitor_name": v.get("visitor_name") or (visitor["full_name"] if visitor else "Removed visitor"),
        "visitor_phone_masked": mask_phone(dec(visitor.get("phone_encrypted"))) if visitor else None,
        "visit_type": v["visit_type"], "pass_type": v["pass_type"],
        "valid_from": v["valid_from"], "valid_to": v["valid_to"],
        "max_scans": v["max_scans"], "scan_count": v["scan_count"],
        "remaining_entries": max(0, v["max_scans"] - v["scan_count"]),
        "vehicle_plate": dec(v.get("vehicle_plate_encrypted")), "purpose": v.get("purpose"),
        "schedule": v.get("schedule"), "status": v["status"], "created_at": v["created_at"],
        "created_by_role": v.get("created_by_role"), "last_entry_at": v.get("last_entry_at"),
    }


async def guard_response(visit: dict, result: str, reason: Optional[str], scan_id: str, tz: str) -> dict:
    """Minimum data the guard needs. Never phone numbers, emails or history."""
    visitor = await db.visitors.find_one({"id": visit["visitor_id"]})
    resident = await db.residents.find_one({"id": visit["resident_id"]})
    base = {
        "result": result, "scan_id": scan_id,
        "visitor_name": visit.get("visitor_name") or (visitor["full_name"] if visitor else "Unknown"),
        "host_name": resident.get("display_name") if resident else "Unknown",
        "house_number": visit["house_number"],
    }
    if result == "ALLOW":
        base.update({
            "valid_until": visit["valid_to"].astimezone(ZoneInfo(tz)).isoformat(),
            "vehicle_plate": dec(visit.get("vehicle_plate_encrypted")),
            "pass_type": visit["pass_type"],
            "remaining_entries": max(0, visit["max_scans"] - visit["scan_count"] - 1),
        })
    else:
        base["reason"] = reason
        if result in ("NEEDS_REVIEW",):
            base["pass_type"] = visit["pass_type"]
    return base


async def record_incident(estate_id: str, kind: str, guard_id: str, gate_id: Optional[str],
                          visit_id: Optional[str], details: str):
    await db.incidents.insert_one({"id": new_id(), "estate_id": estate_id, "type": kind, "guard_id": guard_id,
                                   "gate_id": gate_id, "visit_id": visit_id, "details": details,
                                   "resolved": False, "created_at": now()})


async def household_resident_ids(estate_id: str, house_number: str) -> list[str]:
    docs = await db.residents.find({"estate_id": estate_id, "house_number": house_number, "status": "active"},
                                   {"id": 1}).to_list(20)
    return [d["id"] for d in docs]


async def run_retention(estate: dict) -> dict:
    """Delete visit records past the retention period; anonymise scan events; drop orphan visitors."""
    days = (estate.get("access_rules") or {}).get("retention_days", 180)
    cutoff = now() - timedelta(days=days)
    old = await db.visits.find({"estate_id": estate["id"], "valid_to": {"$lt": cutoff}}, {"id": 1, "visitor_id": 1}).to_list(10000)
    old_ids = [v["id"] for v in old]
    if old_ids:
        await db.scan_events.update_many({"visit_id": {"$in": old_ids}}, {"$set": {"visit_id": None, "notes": "anonymised"}})
        await db.visits.delete_many({"id": {"$in": old_ids}})
    orphan = 0
    for vid in {v["visitor_id"] for v in old}:
        if not await db.visits.find_one({"visitor_id": vid}):
            await db.visitors.delete_one({"id": vid})
            orphan += 1
    reqs = await db.visitor_requests.delete_many({"estate_id": estate["id"], "created_at": {"$lt": cutoff}})
    await db.notifications.delete_many({"created_at": {"$lt": cutoff}})
    summary = {"retention_days": days, "visits_deleted": len(old_ids), "visitors_deleted": orphan,
               "requests_deleted": reqs.deleted_count}
    await audit(None, "retention_job_run", "estate", estate["id"], estate["id"], summary)
    await db.estates.update_one({"id": estate["id"]}, {"$set": {"last_retention_run": now()}})
    return summary


def to_utc(dt: datetime) -> datetime:
    return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).astimezone(timezone.utc)
