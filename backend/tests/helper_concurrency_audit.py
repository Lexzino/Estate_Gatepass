"""Repro: concurrent requests that write audit logs race on audit_logs.seq unique index -> 500."""
from concurrent.futures import ThreadPoolExecutor
import requests
from dotenv import dotenv_values
API = dotenv_values("/app/frontend/.env")["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") + "/api"


def go(_):
    return requests.post(f"{API}/auth/login", json={"identifier": "chinedu@estategate.ng", "password": "Resident@123!"}).status_code


with ThreadPoolExecutor(12) as ex:
    codes = list(ex.map(go, range(12)))
print("status codes:", codes, "500s:", codes.count(500))
