"""Emergent managed push relay + in-app notification helper."""
import asyncio
import logging
import os

import httpx
from fastapi import HTTPException

from core import db, new_id, now

logger = logging.getLogger("estategate.push")
PUSH_BASE_URL = "https://integrations.emergentagent.com"
PUSH_KEY = os.environ.get("EMERGENT_PUSH_KEY", "placeholder")

_client = httpx.AsyncClient(base_url=PUSH_BASE_URL, headers={"X-Push-Key": PUSH_KEY}, timeout=10.0)


async def register_device(user_id: str, platform: str, device_token: str):
    resp = await _client.post("/api/v1/push/users/register",
                              json={"user_id": user_id, "platform": platform, "device_token": device_token})
    if resp.status_code == 401:
        raise HTTPException(500, "EMERGENT_PUSH_KEY missing or invalid")
    if resp.status_code >= 500:
        raise HTTPException(502, "Push provider unavailable")
    resp.raise_for_status()


async def send_push(recipients: list[str], data: dict, idempotency_key: str = None, _attempt: int = 0) -> None:
    if not recipients:
        return
    payload = {"recipients": recipients[:100], "data": data}
    if idempotency_key:
        payload["$idempotency_key"] = idempotency_key
    resp = await _client.post("/api/v1/push/trigger", json=payload)
    if resp.status_code == 401:
        raise HTTPException(500, "EMERGENT_PUSH_KEY missing or invalid")
    code = resp.json().get("code", "") if resp.headers.get("content-type", "").startswith("application/json") else ""
    if code == "idempotency_key_in_progress" and idempotency_key and _attempt < 3:
        await asyncio.sleep(3)
        return await send_push(recipients, data, idempotency_key, _attempt + 1)
    if code in ("insufficient_credits", "integration_disabled", "daily_limit_reached"):
        logger.warning(f"Push paused: {code}")
        return
    if resp.status_code >= 500:
        raise HTTPException(502, "Push provider unavailable")
    resp.raise_for_status()


async def notify_residents(resident_ids: list[str], kind: str, title: str, message: str, ref: dict = None,
                           action_url: str = "/resident/alerts"):
    """Store an in-app notification and fire a push (non-blocking on failure)."""
    docs = [{"id": new_id(), "resident_id": rid, "kind": kind, "title": title, "message": message,
             "ref": ref or {}, "read": False, "created_at": now()} for rid in resident_ids]
    if docs:
        await db.notifications.insert_many(docs)
    try:
        await send_push(resident_ids, {"title": title, "message": message, "action_url": action_url},
                        idempotency_key=docs[0]["id"] if docs else None)
    except Exception as e:  # push failure never blocks gate operations
        logger.warning(f"Push failed (non-blocking): {type(e).__name__}")
