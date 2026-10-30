"""EstateGate tests: unit (crypto + rules) and API (auth, RBAC, isolation, scans, offline sync, audit, retention).
Run: cd /app/backend && python -m pytest tests -q -n 0   (API tests need the server on localhost:8001 with seed data)
"""
import hashlib
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core import sign_pass, verify_pass  # noqa: E402
from passes import evaluate, in_schedule, validate_window  # noqa: E402

API = os.environ.get("ESTATEGATE_API", "http://localhost:8001/api")
NOW = datetime.now(timezone.utc)
TZ = "Africa/Lagos"


# ------------------------------------------------------------------ unit: tokens
def test_token_signing_roundtrip_and_no_pii():
    tok, sig, nonce = sign_pass("LKG", NOW, NOW + timedelta(hours=2))
    p = verify_pass(tok)
    assert p and p["ec"] == "LKG" and p["n"] == nonce and len(p["s"]) >= 22  # >=128-bit secret
    assert set(p) == {"v", "ec", "n", "s", "f", "t", "k"}  # no names, phones, houses or DB ids


def test_tampered_token_rejected():
    tok, _, _ = sign_pass("LKG", NOW, NOW + timedelta(hours=2))
    prefix, body, sig = tok.split(".")
    flip = lambda x, i: x[:i] + ("B" if x[i] != "B" else "C") + x[i + 1:]  # noqa: E731
    assert verify_pass(f"{prefix}.{flip(body, 10)}.{sig}") is None
    assert verify_pass(f"{prefix}.{body}.{flip(sig, 20)}") is None
    assert verify_pass("garbage") is None


def test_nonces_unique():
    assert len({sign_pass("LKG", NOW, NOW + timedelta(hours=1))[2] for _ in range(200)}) == 200


# ------------------------------------------------------------------ unit: rules
def visit(**kw):
    base = {"status": "active", "valid_from": NOW - timedelta(hours=1), "valid_to": NOW + timedelta(hours=1),
            "scan_count": 0, "max_scans": 1, "pass_type": "one_time", "allowed_gate_ids": [], "schedule": None}
    return {**base, **kw}


@pytest.mark.parametrize("kw,expected", [
    ({}, "ALLOW"),
    ({"status": "revoked"}, "REVOKED"),
    ({"valid_to": NOW - timedelta(minutes=1)}, "EXPIRED"),
    ({"scan_count": 1}, "ALREADY_USED"),
    ({"status": "used"}, "ALREADY_USED"),
    ({"valid_from": NOW + timedelta(hours=1), "valid_to": NOW + timedelta(hours=2)}, "NEEDS_REVIEW"),
    ({"status": "pending"}, "NEEDS_REVIEW"),
    ({"allowed_gate_ids": ["other"]}, "DENIED"),
])
def test_evaluate(kw, expected):
    assert evaluate(visit(**kw), NOW, TZ, "g1")[0] == expected


def test_recurring_schedule():
    sch = {"days": [0], "start": "08:00", "end": "17:00"}  # Mondays only
    monday_10_lagos = datetime(2026, 11, 2, 9, 0, tzinfo=timezone.utc)  # 10:00 WAT
    tuesday = monday_10_lagos + timedelta(days=1)
    assert in_schedule(sch, monday_10_lagos, TZ)
    assert not in_schedule(sch, tuesday, TZ)
    assert not in_schedule(sch, monday_10_lagos + timedelta(hours=9), TZ)
    v = visit(pass_type="recurring", max_scans=10, schedule=sch, valid_from=monday_10_lagos - timedelta(days=1),
              valid_to=monday_10_lagos + timedelta(days=30))
    assert evaluate(v, monday_10_lagos, TZ)[0] == "ALLOW"
    assert evaluate(v, tuesday, TZ) == ("NEEDS_REVIEW", "OUTSIDE_SCHEDULE")


def test_window_validation():
    assert validate_window("one_time", NOW, NOW + timedelta(hours=25), NOW)
    assert validate_window("one_time", NOW, NOW + timedelta(hours=4), NOW) is None
    assert validate_window("time_window", NOW, NOW + timedelta(days=8), NOW)
    assert validate_window("one_time", NOW, NOW - timedelta(hours=1), NOW)


# ------------------------------------------------------------------ API helpers
def _up():
    try:
        return requests.get(API.replace("/api", "/health"), timeout=3).ok
    except requests.RequestException:
        return False


api_only = pytest.mark.skipif(not _up(), reason="API not running")
S = requests.Session()


def login(identifier, password, device_id=None):
    r = S.post(f"{API}/auth/login", json={"identifier": identifier, "password": password, "device_id": device_id})
    assert r.status_code == 200, r.text
    return r.json()


def H(tok):
    return {"Authorization": f"Bearer {tok['access_token']}"}


@pytest.fixture(scope="module")
def admin():
    return login("admin@estategate.ng", "Admin@12345!")


@pytest.fixture(scope="module")
def resident():
    return login("adaeze@estategate.ng", "Resident@123!")


@pytest.fixture(scope="module")
def other_resident():
    return login("chinedu@estategate.ng", "Resident@123!")


@pytest.fixture(scope="module")
def guard(admin):
    gid = next(g["id"] for g in S.get(f"{API}/admin/guards", headers=H(admin)).json() if g["full_name"] == "Emeka Obi")
    S.post(f"{API}/admin/devices/{gid}/reset", headers=H(admin), json={"reason": "automated test device reset"})
    dev = "pytest-" + uuid.uuid4().hex[:12]
    tok = login("+2348020000002", "Guard@12345!", dev)
    me = S.get(f"{API}/guard/me", headers=H(tok)).json()
    return {**tok, "gate": me["gates"][0]["id"], "device": dev, "guard_id": gid}


def new_pass(resident, **kw):
    body = {"visitor_name": "Test Visitor", "visitor_phone": "+2348039999" + str(uuid.uuid4().int)[:3],
            "visit_type": "family_friend", "pass_type": "one_time",
            "valid_from": datetime.now(timezone.utc).isoformat(),
            "valid_to": (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat(), **kw}
    r = S.post(f"{API}/residents/visits", headers=H(resident), json=body)
    assert r.status_code == 201, r.text
    return r.json()


# ------------------------------------------------------------------ API: auth
@api_only
def test_refresh_rotation_and_reuse_detection():
    t = login("funmi@estategate.ng", "Resident@123!")
    r1 = S.post(f"{API}/auth/refresh", json={"refresh_token": t["refresh_token"]})
    assert r1.status_code == 200 and r1.json()["refresh_token"] != t["refresh_token"]
    assert S.post(f"{API}/auth/refresh", json={"refresh_token": t["refresh_token"]}).status_code == 401  # reuse
    assert S.post(f"{API}/auth/refresh", json={"refresh_token": r1.json()["refresh_token"]}).status_code == 401  # family revoked
    assert S.get(f"{API}/auth/me", headers=H(r1.json())).status_code == 401  # access token of revoked family


@api_only
def test_bad_password_and_validation():
    assert S.post(f"{API}/auth/login", json={"identifier": "adaeze@estategate.ng", "password": "wrong"}).status_code == 401
    assert S.post(f"{API}/auth/register", json={"full_name": "X", "phone": "1", "email": "bad"}).status_code == 422
    assert S.post(f"{API}/auth/login", json={"identifier": "adaeze@estategate.ng", "password": "x", "role": "admin"}).status_code == 422


# ------------------------------------------------------------------ API: RBAC + isolation
@api_only
def test_role_based_access(resident, guard, admin):
    assert S.get(f"{API}/admin/residents", headers=H(resident)).status_code == 403
    assert S.get(f"{API}/admin/residents", headers=H(guard)).status_code == 403
    assert S.post(f"{API}/guard/scan", headers=H(resident), json={"ref": "EG-AAAA-AAAA", "gate_id": "x" * 10}).status_code == 403
    assert S.get(f"{API}/residents/visits", headers=H(guard)).status_code == 403
    assert S.get(f"{API}/residents/visits").status_code == 401


@api_only
def test_household_isolation(resident, other_resident):
    mine = new_pass(resident)["visit"]["id"]
    assert S.get(f"{API}/residents/visits/{mine}", headers=H(other_resident)).status_code == 404
    assert S.post(f"{API}/residents/visits/{mine}/revoke", headers=H(other_resident)).status_code == 404
    assert all(v["id"] != mine for v in S.get(f"{API}/residents/visits", headers=H(other_resident)).json())


# ------------------------------------------------------------------ API: resident -> gate E2E
@api_only
def test_end_to_end_one_time_pass(resident, guard):
    created = new_pass(resident, vehicle_plate="ABC-123")
    tok = created["token"]
    r = S.post(f"{API}/guard/scan", headers=H(guard), json={"token": tok, "gate_id": guard["gate"]}).json()
    assert r["result"] == "ALLOW" and r["house_number"] == "B12" and r["vehicle_plate"] == "ABC-123"
    assert not {"phone", "email", "visitor_phone", "resident_phone"} & set(r)
    assert S.post(f"{API}/guard/entry-confirm", headers=H(guard), json={"scan_id": r["scan_id"], "decision": "admit"}).status_code == 422
    c = S.post(f"{API}/guard/entry-confirm", headers=H(guard), json={"scan_id": r["scan_id"], "decision": "admit", "identity_confirmed": True}).json()
    assert c["result"] == "ADMITTED"
    again = S.post(f"{API}/guard/scan", headers=H(guard), json={"token": tok, "gate_id": guard["gate"]}).json()
    assert again["result"] == "ALREADY_USED"
    notes = S.get(f"{API}/residents/notifications", headers=H(resident)).json()
    assert any(n["kind"] == "check_in" for n in notes)
    assert S.post(f"{API}/guard/exit-event", headers=H(guard), json={"scan_id": r["scan_id"]}).status_code == 200


@api_only
def test_revoked_and_forged(resident, guard):
    created = new_pass(resident)
    S.post(f"{API}/residents/visits/{created['visit']['id']}/revoke", headers=H(resident))
    r = S.post(f"{API}/guard/scan", headers=H(guard), json={"token": created["token"], "gate_id": guard["gate"]}).json()
    assert r["result"] == "REVOKED" and r["reason"] == "PASS_REVOKED"
    forged = created["token"][:-3] + "AAA"
    assert S.post(f"{API}/guard/scan", headers=H(guard), json={"token": forged, "gate_id": guard["gate"]}).json()["reason"] == "INVALID_SIGNATURE"


@api_only
def test_reissue_invalidates_old_token(resident, guard):
    created = new_pass(resident)
    new = S.post(f"{API}/residents/visits/{created['visit']['id']}/reissue", headers=H(resident)).json()["token"]
    assert S.post(f"{API}/guard/scan", headers=H(guard), json={"token": created["token"], "gate_id": guard["gate"]}).json()["reason"] == "UNKNOWN_PASS"
    assert S.post(f"{API}/guard/scan", headers=H(guard), json={"token": new, "gate_id": guard["gate"]}).json()["result"] == "ALLOW"


# ------------------------------------------------------------------ API: offline
@api_only
def test_offline_cache_minimal_and_duplicate_detection(resident, guard):
    created = new_pass(resident)
    cache = S.get(f"{API}/guard/offline-passes", headers=H(guard)).json()
    entry = next(p for p in cache["passes"] if p["h"] == hashlib.sha256(created["token"].encode()).hexdigest())
    assert set(entry) == {"h", "vn", "hn", "house", "f", "t", "max", "count", "type", "gates", "sch"}
    item = lambda: {"local_id": uuid.uuid4().hex, "token_hash": entry["h"], "gate_id": guard["gate"],  # noqa: E731
                    "scanned_at": datetime.now(timezone.utc).isoformat(), "local_result": "ALLOW",
                    "admitted": True, "identity_confirmed": True}
    first, second = item(), item()
    r = S.post(f"{API}/guard/scan/offline-sync", headers=H(guard), json={"items": [first, second]}).json()
    assert r["synced"] == 2 and r["flagged"] == 1  # two offline gates admitted the same one-time pass
    r2 = S.post(f"{API}/guard/scan/offline-sync", headers=H(guard), json={"items": [first]}).json()
    assert r2["results"][0]["status"] == "already_synced"  # idempotent upload


# ------------------------------------------------------------------ API: admin, audit, retention
@api_only
def test_pii_reveal_audited_and_chain(admin):
    visits = S.get(f"{API}/admin/visits", headers=H(admin)).json()
    assert "visitor_phone" not in visits[0]
    assert S.post(f"{API}/admin/visits/{visits[0]['id']}/reveal", headers=H(admin), json={"reason": "short"}).status_code == 422
    assert S.post(f"{API}/admin/visits/{visits[0]['id']}/reveal", headers=H(admin), json={"reason": "incident investigation"}).status_code == 200
    logs = S.get(f"{API}/admin/audit-logs", headers=H(admin)).json()
    assert any(l["action"] == "pii_revealed" for l in logs)
    assert S.get(f"{API}/admin/audit-logs/verify", headers=H(admin)).json()["valid"] is True


@api_only
def test_retention_job(admin):
    r = S.post(f"{API}/admin/retention/run", headers=H(admin)).json()
    assert "visits_deleted" in r and r["retention_days"] in (90, 180, 365)


@api_only
def test_scan_rate_limit(guard):
    codes = [S.post(f"{API}/guard/manual-lookup", headers=H(guard), json={"ref": "EG-ZZZZ-ZZZZ"}).status_code for _ in range(12)]
    assert 429 in codes


@api_only
def test_device_revocation(admin, guard):
    S.post(f"{API}/admin/devices/{guard['guard_id']}/revoke", headers=H(admin), json={"reason": "test lost phone flow"})
    assert S.get(f"{API}/guard/me", headers=H(guard)).status_code in (401, 403)
    S.post(f"{API}/admin/devices/{guard['guard_id']}/reset", headers=H(admin), json={"reason": "restore after revoke test"})
