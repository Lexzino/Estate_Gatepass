"""Idempotent demo seed: 1 estate, 5 residents, 10 visitors, 2 guards, 2 gates, sample passes, 1 admin."""
from datetime import timedelta
from pathlib import Path

from core import db, email_hash, enc, hash_password, new_id, norm_phone, now, phone_hash
from services import create_visit, display_name

ADMIN = ("Tunde Bakare", "admin@estategate.ng", "+2348090000001", "Admin@12345!")
RESIDENTS = [
    ("Adaeze Ade", "B12", "adaeze@estategate.ng", "+2348010000001"),
    ("Chinedu Okafor", "A3", "chinedu@estategate.ng", "+2348010000002"),
    ("Funmi Adeyemi", "C7", "funmi@estategate.ng", "+2348010000003"),
    ("Ibrahim Musa", "D2", "ibrahim@estategate.ng", "+2348010000004"),
    ("Ngozi Eze", "E9", "ngozi@estategate.ng", "+2348010000005"),
]
RESIDENT_PW = "Resident@123!"
GUARDS = [("Musa Danjuma", "+2348020000001"), ("Emeka Obi", "+2348020000002")]
GUARD_PW = "Guard@12345!"
VISITORS = [("John Doe", "+2348031111001"), ("Bola Tinubu Jr", "+2348031111002"), ("Kemi Ojo", "+2348031111003"),
            ("Sani Bello", "+2348031111004"), ("Grace Uche", "+2348031111005"), ("Peter Obi Jnr", "+2348031111006"),
            ("Amaka Nwosu", "+2348031111007"), ("Yusuf Ali", "+2348031111008"), ("Tolu Ade", "+2348031111009"),
            ("Femi Kuti", "+2348031111010")]


async def ensure_indexes():
    await db.residents.create_index("email_hash", unique=True)
    await db.residents.create_index("phone_hash", unique=True)
    await db.guards.create_index("phone_hash", unique=True)
    await db.admins.create_index("email_hash", unique=True)
    await db.visitors.create_index("phone_hash", unique=True)
    await db.visits.create_index("pass_token_hash", unique=True)
    await db.visits.create_index("ref_code", unique=True)
    await db.visits.create_index([("estate_id", 1), ("house_number", 1), ("status", 1)])
    await db.scan_events.create_index([("estate_id", 1), ("scanned_at", -1)])
    await db.scan_events.create_index([("device_id", 1), ("local_id", 1)])
    await db.refresh_tokens.create_index("token_hash", unique=True)
    await db.refresh_tokens.create_index("expires_at", expireAfterSeconds=0)
    await db.token_families.create_index("id", unique=True)
    await db.audit_logs.create_index("seq", unique=True)
    await db.otp_codes.create_index("expires_at", expireAfterSeconds=3600)


async def seed():
    if await db.estates.find_one({"code": "LKG"}):
        return
    t = now()
    estate = {"id": new_id(), "name": "Lekki Gardens Estate", "code": "LKG", "address": "Lekki Phase 1, Lagos",
              "timezone": "Africa/Lagos", "access_rules": {"retention_days": 180, "offline_cache_hours": 48,
              "walk_in_pass_minutes": 60, "default_one_time_hours": 6}, "created_at": t, "updated_at": t}
    await db.estates.insert_one(estate)
    gates = [{"id": new_id(), "estate_id": estate["id"], "name": n, "location": loc, "status": "active"}
             for n, loc in (("Main Gate", "Admiralty Way entrance"), ("Back Gate", "Lagoon road service entrance"))]
    await db.gates.insert_many(gates)
    await db.admins.insert_one({"id": new_id(), "role": "admin", "full_name": ADMIN[0], "estate_ids": [estate["id"]],
                                "email_hash": email_hash(ADMIN[1]), "email_encrypted": enc(ADMIN[1]),
                                "phone_hash": phone_hash(ADMIN[2]), "password_hash": hash_password(ADMIN[3]),
                                "status": "active", "failed_logins": 0, "created_at": t, "updated_at": t})
    residents = []
    for name, house, email, phone in RESIDENTS:
        r = {"id": new_id(), "role": "resident", "estate_id": estate["id"], "full_name": name,
             "display_name": display_name(name), "house_number": house, "phone_encrypted": enc(norm_phone(phone)),
             "phone_hash": phone_hash(phone), "email_encrypted": enc(email), "email_hash": email_hash(email),
             "password_hash": hash_password(RESIDENT_PW), "status": "active", "failed_logins": 0,
             "created_at": t, "updated_at": t}
        residents.append(r)
    await db.residents.insert_many(residents)
    for name, phone in GUARDS:
        await db.guards.insert_one({"id": new_id(), "role": "guard", "estate_id": estate["id"], "full_name": name,
                                    "phone_encrypted": enc(norm_phone(phone)), "phone_hash": phone_hash(phone),
                                    "password_hash": hash_password(GUARD_PW), "status": "active", "device_id": None,
                                    "device_status": "unbound", "last_active_at": None, "failed_logins": 0,
                                    "created_at": t, "updated_at": t})
    ade = residents[0]
    samples = [  # (resident, visitor idx, pass_type, visit_type, from, to, max, schedule, label)
        (ade, 0, "one_time", "family_friend", t, t + timedelta(hours=8), 1, None, "one_time_active"),
        (ade, 1, "recurring", "domestic_staff", t - timedelta(days=1), t + timedelta(days=30), 60,
         {"days": [0, 1, 2, 3, 4, 5, 6], "start": "00:00", "end": "23:59"}, "recurring_active"),
        (ade, 2, "contractor", "contractor", t, t + timedelta(days=14), 30, {"days": [0, 1, 2, 3, 4, 5], "start": "08:00", "end": "18:00"}, "contractor_active"),
        (ade, 3, "one_time", "delivery", t - timedelta(days=2), t - timedelta(days=2) + timedelta(hours=2), 1, None, "expired"),
        (ade, 4, "time_window", "family_friend", t, t + timedelta(days=2), 4, None, "revoked"),
        (residents[1], 5, "one_time", "family_friend", t, t + timedelta(hours=6), 1, None, "other_household"),
        (residents[2], 6, "time_window", "delivery", t, t + timedelta(hours=12), 2, None, "c7_window"),
        (residents[3], 7, "one_time", "other", t, t + timedelta(hours=4), 1, None, "d2_one_time"),
        (residents[4], 8, "recurring", "domestic_staff", t, t + timedelta(days=30), 40, {"days": [0, 2, 4], "start": "07:00", "end": "17:00"}, "e9_recurring"),
        (ade, 9, "one_time", "delivery", t, t + timedelta(hours=3), 1, None, "used"),
    ]
    tokens = []
    for r, vi, ptype, vtype, vf, vt, mx, sch, label in samples:
        valid_to = vt if label != "expired" else t + timedelta(minutes=1)
        visit, token = await create_visit(estate, r, visitor_name=VISITORS[vi][0], visitor_phone=VISITORS[vi][1],
                                          pass_type=ptype, visit_type=vtype, valid_from=vf, valid_to=valid_to,
                                          max_scans=mx, vehicle_plate="LND-482KJ" if vi == 0 else None,
                                          purpose="Seeded demo pass", schedule=sch, allowed_gate_ids=None,
                                          created_by=r)
        patch = {}
        if label == "expired":
            patch = {"valid_to": vt, "status": "expired"}
        elif label == "revoked":
            patch = {"status": "revoked", "revoked_at": t}
        elif label == "used":
            patch = {"status": "used", "scan_count": 1, "last_entry_at": t - timedelta(minutes=30)}
        if patch:
            await db.visits.update_one({"id": visit["id"]}, {"$set": patch})
        tokens.append((label, r["house_number"], visit["ref_code"], token))
    lines = ["# Seeded demo pass tokens (dev only, raw tokens are never stored in the DB)", ""]
    lines += [f"- {label} | house {house} | ref {ref}\n  `{tok}`" for label, house, ref, tok in tokens]
    Path("/app/memory").mkdir(exist_ok=True)
    Path("/app/memory/seed_pass_tokens.md").write_text("\n".join(lines) + "\n")
