"""Helper: reset Guard 1 device binding and create a fresh one-time pass for UI lookup tests."""
from datetime import datetime, timedelta, timezone
import requests
from dotenv import dotenv_values
API = dotenv_values("/app/frontend/.env")["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") + "/api"
lg = lambda i, p: requests.post(f"{API}/auth/login", json={"identifier": i, "password": p}).json()
a = lg("admin@estategate.ng", "Admin@12345!"); ha = {"Authorization": f"Bearer {a['access_token']}"}
gid = next(g["id"] for g in requests.get(f"{API}/admin/guards", headers=ha).json() if g["full_name"] == "Musa Danjuma")
print("reset", requests.post(f"{API}/admin/devices/{gid}/reset", headers=ha, json={"reason": "ui test reset device"}).status_code)
r = lg("adaeze@estategate.ng", "Resident@123!"); hr = {"Authorization": f"Bearer {r['access_token']}"}
n = datetime.now(timezone.utc)
for name in ("UI Token Guest", "UI Ref Guest"):
    v = requests.post(f"{API}/residents/visits", headers=hr, json={"visitor_name": name, "visitor_phone": "+2348030001234",
        "visit_type": "family_friend", "pass_type": "one_time", "valid_from": n.isoformat(), "valid_to": (n + timedelta(hours=3)).isoformat()}).json()
    print(name, "|", v["visit"]["ref_code"], "|", v["token"])
