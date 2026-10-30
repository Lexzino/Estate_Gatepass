"""Helper: create a pending walk-in visitor request for house B12 via Guard 2 (for UI tests)."""
import uuid
import requests
from dotenv import dotenv_values

API = dotenv_values("/app/frontend/.env")["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") + "/api"
lg = lambda i, p, d=None: requests.post(f"{API}/auth/login", json={"identifier": i, "password": p, "device_id": d}).json()  # noqa: E731
a = lg("admin@estategate.ng", "Admin@12345!")
ha = {"Authorization": f"Bearer {a['access_token']}"}
gid = next(g["id"] for g in requests.get(f"{API}/admin/guards", headers=ha).json() if g["full_name"] == "Emeka Obi")
requests.post(f"{API}/admin/devices/{gid}/reset", headers=ha, json={"reason": "ui helper reset device"})
g = lg("+2348020000002", "Guard@12345!", "helper-" + uuid.uuid4().hex[:10])
hg = {"Authorization": f"Bearer {g['access_token']}"}
gate = requests.get(f"{API}/guard/me", headers=hg).json()["gates"][0]["id"]
r = requests.post(f"{API}/guard/manual-override", headers=hg, json={"visitor_name": "UI Walkin Guest", "visitor_phone": "+2348035550000",
                                                                   "house_number": "B12", "gate_id": gate})
print(r.status_code, r.json())
