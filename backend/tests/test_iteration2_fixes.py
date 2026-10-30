"""Iteration-2 regression: visitor-name snapshot, manual-lookup any status, resolved gate-request notifications.
Run: cd /app/backend && python -m pytest tests/test_iteration2_fixes.py -q
"""
import uuid
from datetime import timedelta

import pytest
from dotenv import dotenv_values
from pymongo import MongoClient

from test_estategate_public_api import API, NOW, S, H, admin, resident, other_resident, guard, new_pass, scan  # noqa: F401

ENV = dotenv_values("/app/backend/.env")
DB = MongoClient(ENV["MONGO_URL"])[ENV["DB_NAME"]]


def lookup(guard, **kw):
    r = S.post(f"{API}/guard/manual-lookup", headers=H(guard), json=kw)
    assert r.status_code == 200, r.text
    return r.json()


# Visitor-name snapshot: same phone used by another household must not rename older pass on any surface
@pytest.fixture(scope="module")
def shared_phone_passes(resident, other_resident):
    phone = "+234807" + str(uuid.uuid4().int)[:7]
    mine = new_pass(resident, visitor_name="Alice Original", visitor_phone=phone)
    theirs = new_pass(other_resident, visitor_name="Mallory Other", visitor_phone=phone)
    return mine, theirs, phone


def test_name_resident_detail_and_list(resident, other_resident, shared_phone_passes):
    mine, theirs, _ = shared_phone_passes
    d = S.get(f"{API}/residents/visits/{mine['visit']['id']}", headers=H(resident)).json()
    assert d["visitor_name"] == "Alice Original"
    lst = S.get(f"{API}/residents/visits", headers=H(resident)).json()
    items = lst if isinstance(lst, list) else lst.get("items", lst.get("visits", []))
    assert next(v for v in items if v["id"] == mine["visit"]["id"])["visitor_name"] == "Alice Original"
    o = S.get(f"{API}/residents/visits/{theirs['visit']['id']}", headers=H(other_resident)).json()
    assert o["visitor_name"] == "Mallory Other"


def test_name_admin_list_and_reveal(admin, shared_phone_passes):
    mine, theirs, _ = shared_phone_passes
    lst = S.get(f"{API}/admin/visits", headers=H(admin)).json()
    assert next(v for v in lst if v["id"] == mine["visit"]["id"])["visitor"] == "Alice O."
    assert next(v for v in lst if v["id"] == theirs["visit"]["id"])["visitor"] == "Mallory O."
    rv = S.post(f"{API}/admin/visits/{mine['visit']['id']}/reveal", headers=H(admin), json={"reason": "automated iteration two check"})
    assert rv.status_code == 200, rv.text
    assert rv.json()["visitor_name"] == "Alice Original"


def test_name_public_page(shared_phone_passes):
    mine, _, _ = shared_phone_passes
    html = S.get(f"{API}/p/{mine['token']}").text
    assert "Alice" in html and "Mallory" not in html


def test_name_offline_cache_and_phone_lookup(guard, shared_phone_passes):
    mine, theirs, phone = shared_phone_passes
    import hashlib
    c = S.get(f"{API}/guard/offline-passes", headers=H(guard)).json()
    names = {p["h"]: p["vn"] for p in c["passes"]}
    assert names[hashlib.sha256(mine["token"].encode()).hexdigest()] == "Alice Original"
    assert names[hashlib.sha256(theirs["token"].encode()).hexdigest()] == "Mallory Other"
    res = {m["ref_code"]: m["visitor_name"] for m in lookup(guard, phone=phone)}
    assert res[mine["visit"]["ref_code"]] == "Alice Original"
    assert res[theirs["visit"]["ref_code"]] == "Mallory Other"


def test_name_guard_scan(guard, shared_phone_passes):
    mine, theirs, _ = shared_phone_passes
    assert scan(guard, token=mine["token"])["visitor_name"] == "Alice Original"
    assert scan(guard, token=theirs["token"])["visitor_name"] == "Mallory Other"


# Manual lookup by ref returns pass in any status; verify by ref reports EXPIRED / ALREADY_USED
def test_lookup_ref_expired(resident, guard):
    p = new_pass(resident, visitor_name="TEST Expired Guest")
    ref = p["visit"]["ref_code"]
    DB.visits.update_one({"ref_code": ref}, {"$set": {"valid_to": NOW() - timedelta(minutes=5)}})
    m = lookup(guard, ref=ref)
    assert len(m) == 1 and m[0]["status"] == "expired"
    assert scan(guard, ref=ref)["result"] == "EXPIRED"


def test_lookup_ref_used(resident, guard):
    p = new_pass(resident, visitor_name="TEST Used Guest")
    ref = p["visit"]["ref_code"]
    first = scan(guard, token=p["token"])
    assert first["result"] == "ALLOW"
    c = S.post(f"{API}/guard/entry-confirm", headers=H(guard), json={"scan_id": first["scan_id"], "decision": "admit", "identity_confirmed": True})
    assert c.status_code == 200, c.text
    m = lookup(guard, ref=ref)
    assert len(m) == 1 and m[0]["status"] == "used", m
    assert scan(guard, ref=ref)["result"] == "ALREADY_USED"


def test_lookup_phone_still_active_only(resident, guard):
    phone = "+234809" + str(uuid.uuid4().int)[:7]
    p = new_pass(resident, visitor_name="TEST Phone Guest", visitor_phone=phone)
    DB.visits.update_one({"ref_code": p["visit"]["ref_code"]}, {"$set": {"valid_to": NOW() - timedelta(minutes=5)}})
    assert lookup(guard, phone=phone) == []


# Resolved gate-request notifications are rewritten
@pytest.mark.parametrize("action,prefix", [("approve", "Approved by"), ("reject", "Rejected by")])
def test_request_notification_resolved(resident, guard, action, prefix):
    r = S.post(f"{API}/guard/manual-override", headers=H(guard), json={
        "visitor_name": f"TEST Notif {action.title()}", "visitor_phone": "+234803" + str(uuid.uuid4().int)[:7],
        "house_number": "B12", "gate_id": guard["gate"]})
    assert r.status_code == 201, r.text
    rid = r.json()["id"]
    assert S.post(f"{API}/residents/visitor-requests/{rid}/{action}", headers=H(resident)).status_code == 200
    raw = S.get(f"{API}/residents/notifications", headers=H(resident)).json()
    items = raw if isinstance(raw, list) else raw.get("items", raw.get("notifications", []))
    n = [x for x in items if (x.get("ref") or {}).get("request_id") == rid]
    if not n:  # ref may not be exposed in API; fall back to DB
        n = list(DB.notifications.find({"ref.request_id": rid}, {"_id": 0}))
    assert n, "notification not found"
    for x in n:
        assert x["title"] == "Gate request handled"
        assert x["message"].startswith(prefix), x["message"]
