"""EstateGate public-URL regression suite (auth, resident, guard, admin, public, RBAC).
Run: cd /app/backend && python -m pytest tests/test_estategate_public_api.py -q -n 0
"""
import hashlib
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from dotenv import dotenv_values

BASE = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or dotenv_values("/app/frontend/.env")["EXPO_PUBLIC_BACKEND_URL"]).rstrip("/")
API = f"{BASE}/api"
S = requests.Session()
NOW = lambda: datetime.now(timezone.utc)  # noqa: E731


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
    return login("funmi@estategate.ng", "Resident@123!")


@pytest.fixture(scope="module")
def guard(admin):
    return fresh_guard(admin)


def fresh_guard(admin):
    gid = next(g["id"] for g in S.get(f"{API}/admin/guards", headers=H(admin)).json() if g["full_name"] == "Emeka Obi")
    S.post(f"{API}/admin/devices/{gid}/reset", headers=H(admin), json={"reason": "automated public test reset"})
    dev = "pub-" + uuid.uuid4().hex[:12]
    tok = login("+2348020000002", "Guard@12345!", dev)
    me = S.get(f"{API}/guard/me", headers=H(tok)).json()
    return {**tok, "gate": me["gates"][0]["id"], "guard_id": gid, "device": dev}


def new_pass(res, **kw):
    body = {"visitor_name": "TEST Visitor", "visitor_phone": "+234803" + str(uuid.uuid4().int)[:7],
            "visit_type": "family_friend", "pass_type": "one_time",
            "valid_from": NOW().isoformat(), "valid_to": (NOW() + timedelta(hours=2)).isoformat(), **kw}
    r = S.post(f"{API}/residents/visits", headers=H(res), json=body)
    assert r.status_code == 201, r.text
    return r.json()


def scan(guard, **kw):
    r = S.post(f"{API}/guard/scan", headers=H(guard), json={"gate_id": guard["gate"], **kw})
    assert r.status_code == 200, r.text
    return r.json()


# Auth: password reset (dev_otp MOCKED) + verify-otp + logout
def test_password_reset_and_logout():
    r = S.post(f"{API}/auth/password-reset", json={"identifier": "ngozi@estategate.ng"})
    assert r.status_code == 200, r.text
    otp = r.json().get("dev_otp")
    assert otp and len(otp) == 6
    bad = S.post(f"{API}/auth/verify-otp", json={"identifier": "ngozi@estategate.ng", "otp": "000000" if otp != "000000" else "111111", "new_password": "Resident@123!"})
    assert bad.status_code in (400, 401)
    ok = S.post(f"{API}/auth/verify-otp", json={"identifier": "ngozi@estategate.ng", "otp": otp, "new_password": "Resident@123!"})
    assert ok.status_code == 200, ok.text
    tok = login("ngozi@estategate.ng", "Resident@123!")
    assert S.post(f"{API}/auth/logout", headers=H(tok), json={"refresh_token": tok["refresh_token"]}).status_code == 200
    assert S.post(f"{API}/auth/refresh", json={"refresh_token": tok["refresh_token"]}).status_code == 401


# Auth: register -> pending -> admin approves -> login works
def test_register_pending_then_approve(admin):
    email = f"test_{uuid.uuid4().hex[:6]}@example.com"
    body = {"full_name": "TEST Newbie", "phone": "+234809" + str(uuid.uuid4().int)[:7], "email": email,
            "password": "Newbie@12345", "house_number": "B12", "estate_code": "LKG"}
    r = S.post(f"{API}/auth/register", json=body)
    assert r.status_code == 201, r.text
    pre = S.post(f"{API}/auth/login", json={"identifier": email, "password": "Newbie@12345"})
    assert pre.status_code in (401, 403), pre.text
    rid = next(x["id"] for x in S.get(f"{API}/admin/residents", headers=H(admin)).json() if x.get("status") == "pending" and x.get("full_name") == "TEST Newbie")
    ap = S.post(f"{API}/admin/residents/{rid}/status", headers=H(admin), json={"status": "active"})
    assert ap.status_code == 200, ap.text
    login(email, "Newbie@12345")
    S.post(f"{API}/admin/residents/{rid}/status", headers=H(admin), json={"status": "suspended"})
    assert S.post(f"{API}/auth/login", json={"identifier": email, "password": "Newbie@12345"}).status_code in (401, 403)


# Resident: all pass types + list/detail
@pytest.mark.parametrize("kw", [
    {"pass_type": "time_window", "max_scans": 3},
    {"pass_type": "recurring", "visit_type": "domestic_staff", "max_scans": 50,
     "valid_to": (datetime.now(timezone.utc) + timedelta(days=30)).isoformat(),
     "schedule": {"days": [0, 1, 2, 3, 4, 5, 6], "start": "00:00", "end": "23:59"}},
    {"pass_type": "contractor", "visit_type": "contractor", "max_scans": 10, "purpose": "Plumbing"},
])
def test_create_pass_types(resident, kw):
    out = new_pass(resident, **kw)
    assert out["token"].startswith("EG1.")
    v = out["visit"]
    assert v["pass_type"] == kw["pass_type"]
    d = S.get(f"{API}/residents/visits/{v['id']}", headers=H(resident))
    assert d.status_code == 200 and d.json()["id"] == v["id"]
    assert any(x["id"] == v["id"] for x in S.get(f"{API}/residents/visits", headers=H(resident)).json())


def test_recurring_missing_schedule_rejected(resident):
    r = S.post(f"{API}/residents/visits", headers=H(resident), json={
        "visitor_name": "TEST Rec", "visitor_phone": "+2348030000111", "visit_type": "domestic_staff", "pass_type": "recurring",
        "valid_from": NOW().isoformat(), "valid_to": (NOW() + timedelta(days=5)).isoformat()})
    assert r.status_code in (400, 422)


def test_household_isolation(resident, other_resident):
    v = new_pass(resident)["visit"]
    assert S.get(f"{API}/residents/visits/{v['id']}", headers=H(other_resident)).status_code == 404
    assert S.post(f"{API}/residents/visits/{v['id']}/revoke", headers=H(other_resident)).status_code == 404


# Guard: full scan lifecycle ALLOW -> confirm (needs identity) -> exit -> ALREADY_USED; revoke; reissue; forged
def test_guard_scan_lifecycle(resident, guard):
    out = new_pass(resident)
    res = scan(guard, token=out["token"])
    assert res["result"] == "ALLOW" and "visitor_phone" not in res
    no_id = S.post(f"{API}/guard/entry-confirm", headers=H(guard), json={"scan_id": res["scan_id"], "decision": "admit"})
    assert no_id.status_code in (400, 422), no_id.text
    ok = S.post(f"{API}/guard/entry-confirm", headers=H(guard), json={"scan_id": res["scan_id"], "decision": "admit", "identity_confirmed": True})
    assert ok.status_code == 200, ok.text
    ex = S.post(f"{API}/guard/exit-event", headers=H(guard), json={"scan_id": res["scan_id"]})
    assert ex.status_code == 200, ex.text
    assert S.post(f"{API}/guard/exit-event", headers=H(guard), json={"scan_id": res["scan_id"]}).status_code in (400, 409)
    assert scan(guard, token=out["token"])["result"] == "ALREADY_USED"
    hist = S.get(f"{API}/guard/scan-history", headers=H(guard))
    assert hist.status_code == 200 and len(hist.json()) > 0


def test_revoke_reissue_forged_expired(resident, guard):
    a = new_pass(resident)
    assert S.post(f"{API}/residents/visits/{a['visit']['id']}/revoke", headers=H(resident)).status_code == 200
    assert scan(guard, token=a["token"])["result"] == "REVOKED"
    b = new_pass(resident)
    re_ = S.post(f"{API}/residents/visits/{b['visit']['id']}/reissue", headers=H(resident))
    assert re_.status_code == 200
    assert scan(guard, token=b["token"])["result"] == "DENIED"
    assert scan(guard, token=re_.json()["token"])["result"] == "ALLOW"
    forged = b["token"][:-4] + ("AAAA" if not b["token"].endswith("AAAA") else "BBBB")
    f = scan(guard, token=forged)
    assert f["result"] == "DENIED" and f.get("reason") == "INVALID_SIGNATURE"
    assert scan(guard, ref="EG-QKQV-ZKHF")["result"] == "EXPIRED"


def test_scan_by_ref_and_manual_lookup(resident, guard):
    v = new_pass(resident)["visit"]
    assert scan(guard, ref=v["ref_code"])["result"] == "ALLOW"
    lk = S.post(f"{API}/guard/manual-lookup", headers=H(guard), json={"ref": v["ref_code"]})
    assert lk.status_code == 200, lk.text
    assert S.post(f"{API}/guard/manual-lookup", headers=H(guard), json={}).status_code == 422


def test_offline_passes_and_sync(resident, guard):
    out = new_pass(resident)
    op = S.get(f"{API}/guard/offline-passes", headers=H(guard))
    assert op.status_code == 200, op.text
    body = op.json()
    items = body["passes"] if isinstance(body, dict) else body
    assert items and not any(k in items[0] for k in ("visitor_phone", "phone", "email"))
    th = hashlib.sha256(out["token"].encode()).hexdigest()
    lid1, lid2 = "loc-" + uuid.uuid4().hex[:10], "loc-" + uuid.uuid4().hex[:10]
    it = lambda lid: {"local_id": lid, "token_hash": th, "gate_id": guard["gate"], "scanned_at": NOW().isoformat(),  # noqa: E731
                      "local_result": "ALLOW", "admitted": True, "identity_confirmed": True}
    r1 = S.post(f"{API}/guard/scan/offline-sync", headers=H(guard), json={"items": [it(lid1), it(lid2)]})
    assert r1.status_code == 200, r1.text
    r2 = S.post(f"{API}/guard/scan/offline-sync", headers=H(guard), json={"items": [it(lid1)]})
    assert r2.status_code == 200, r2.text
    print("SYNC1", r1.json(), "SYNC2", r2.json())
    assert r1.json().get("flagged", 0) >= 1


# Guard walk-in -> resident approve -> guard scans ref; reject path
def test_manual_override_flow(resident, guard):
    r = S.post(f"{API}/guard/manual-override", headers=H(guard), json={
        "visitor_name": "TEST Walkin", "visitor_phone": "+2348031112222", "house_number": "b12", "gate_id": guard["gate"]})
    assert r.status_code == 201, r.text
    rid = r.json()["id"]
    assert any(x["id"] == rid for x in S.get(f"{API}/residents/visitor-requests", headers=H(resident)).json())
    ap = S.post(f"{API}/residents/visitor-requests/{rid}/approve", headers=H(resident))
    assert ap.status_code == 200, ap.text
    assert S.post(f"{API}/residents/visitor-requests/{rid}/approve", headers=H(resident)).status_code in (400, 404, 409)
    gr = next(x for x in S.get(f"{API}/guard/visitor-requests", headers=H(guard)).json() if x["id"] == rid)
    assert gr["status"] == "approved" and gr["ref_code"] == ap.json()["ref_code"]
    assert scan(guard, ref=gr["ref_code"])["result"] == "ALLOW"
    r2 = S.post(f"{API}/guard/manual-override", headers=H(guard), json={
        "visitor_name": "TEST Reject", "visitor_phone": "+2348031113333", "house_number": "B12", "gate_id": guard["gate"]})
    assert S.post(f"{API}/residents/visitor-requests/{r2.json()['id']}/reject", headers=H(resident)).status_code == 200
    assert S.post(f"{API}/guard/manual-override", headers=H(guard), json={
        "visitor_name": "TEST None", "visitor_phone": "+2348031114444", "house_number": "ZZ99", "gate_id": guard["gate"]}).status_code == 404
    n = S.get(f"{API}/residents/notifications", headers=H(resident))
    assert n.status_code == 200


# Admin endpoints
def test_admin_reads(admin):
    for p in ("overview", "residents", "guards", "gates", "audit-logs", "reports/visitor-traffic",
              "reports/security-incidents", "visits", "privacy-requests", "estates"):
        r = S.get(f"{API}/admin/{p}", headers=H(admin))
        assert r.status_code == 200, f"{p}: {r.status_code} {r.text[:200]}"
    v = S.get(f"{API}/admin/audit-logs/verify", headers=H(admin)).json()
    print("VERIFY", v)
    assert v.get("valid") is True or v.get("ok") is True


def test_admin_reveal_rules_retention(admin):
    visits = S.get(f"{API}/admin/visits", headers=H(admin)).json()
    vid = visits[0]["id"]
    assert "visitor_phone" not in visits[0]
    assert S.post(f"{API}/admin/visits/{vid}/reveal", headers=H(admin), json={"reason": "short"}).status_code == 422
    rv = S.post(f"{API}/admin/visits/{vid}/reveal", headers=H(admin), json={"reason": "Security investigation of incident"})
    assert rv.status_code == 200, rv.text
    est = S.get(f"{API}/admin/estates", headers=H(admin)).json()[0]
    rules = {"retention_days": 180, "offline_cache_hours": 48, "walk_in_pass_minutes": 60, "default_one_time_hours": 4}
    assert S.put(f"{API}/admin/estates/{est['id']}/rules", headers=H(admin), json=rules).status_code == 200
    assert S.put(f"{API}/admin/estates/{est['id']}/rules", headers=H(admin), json={**rules, "retention_days": 30}).status_code == 422
    assert S.post(f"{API}/admin/retention/run", headers=H(admin)).status_code == 200


def test_admin_device_revoke_and_reset(admin):
    gid = next(g["id"] for g in S.get(f"{API}/admin/guards", headers=H(admin)).json() if g["full_name"] == "Emeka Obi")
    assert S.post(f"{API}/admin/devices/{gid}/revoke", headers=H(admin), json={"reason": "x"}).status_code == 422
    assert S.post(f"{API}/admin/devices/{gid}/revoke", headers=H(admin), json={"reason": "lost device test run"}).status_code == 200
    assert S.post(f"{API}/admin/devices/{gid}/reset", headers=H(admin), json={"reason": "reset after test run"}).status_code == 200


# Public
def test_public_pass_page_and_privacy(resident):
    out = new_pass(resident)
    r = S.get(f"{API}/p/{out['token']}")
    assert r.status_code == 200 and "text/html" in r.headers["content-type"]
    assert S.get(f"{API}/p/garbage-token-xyz").status_code in (200, 400, 404)
    pr = S.post(f"{API}/privacy/requests", json={"estate_code": "LKG", "type": "access", "contact": "test@example.com"})
    assert pr.status_code == 201, pr.text
    assert S.post(f"{API}/privacy/requests", json={"estate_code": "NOPE", "type": "access", "contact": "test@example.com"}).status_code == 404


# RBAC
def test_rbac(resident, admin):
    gid = next(g["id"] for g in S.get(f"{API}/admin/guards", headers=H(admin)).json() if g["full_name"] == "Emeka Obi")
    S.post(f"{API}/admin/devices/{gid}/reset", headers=H(admin), json={"reason": "automated rbac test reset"})
    guard = login("+2348020000002", "Guard@12345!", "rbac-" + uuid.uuid4().hex[:10])
    assert S.get(f"{API}/admin/overview", headers=H(resident)).status_code == 403
    assert S.get(f"{API}/guard/me", headers=H(resident)).status_code == 403
    assert S.get(f"{API}/admin/overview", headers=H(guard)).status_code == 403
    assert S.get(f"{API}/residents/visits", headers=H(guard)).status_code == 403
    assert S.get(f"{API}/residents/visits").status_code == 401


# BUG repro: visitors are global by phone hash and full_name is overwritten on every create (services.upsert_visitor)
def test_visitor_name_not_overwritten_across_households(resident, other_resident, admin):
    guard = fresh_guard(admin)  # module guard session was revoked by test_admin_device_revoke_and_reset
    phone = "+234807" + str(uuid.uuid4().int)[:7]
    mine = new_pass(resident, visitor_name="Alice Original", visitor_phone=phone)
    new_pass(other_resident, visitor_name="Mallory Other", visitor_phone=phone)
    d = S.get(f"{API}/residents/visits/{mine['visit']['id']}", headers=H(resident)).json()
    res = scan(guard, token=mine["token"])
    assert res["visitor_name"] == "Alice Original", f"guard sees {res['visitor_name']!r}, resident sees {d.get('visitor_name')!r}"
