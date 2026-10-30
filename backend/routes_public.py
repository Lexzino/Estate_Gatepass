"""Public endpoints: visitor pass page (opened from the shared link) and privacy requests."""
import html
from typing import Literal
from zoneinfo import ZoneInfo

import qrcode
import qrcode.image.svg
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import Field

from core import db, enc, ip_hash, new_id, now, rate_limit, sha256_hex, verify_pass
from routes_auth import Strict

router = APIRouter(prefix="/api", tags=["public"])

PRIVACY_NOTICE = (
    "EstateGate processes your name, phone number and (if provided) vehicle plate only to let the estate "
    "security team confirm your visit. Lawful basis: legitimate interest of the estate in securing its premises "
    "(Nigeria Data Protection Act 2023, s.25). Your phone number and plate are encrypted. Only the inviting household, "
    "the gate guard on duty (name and house number only) and estate administrators (with a logged reason) can see your "
    "details. Records are deleted automatically after the estate's retention period (90 days to 12 months). "
    "To access, correct or delete your data, use the request form linked below or contact the estate administrator."
)


@router.get("/privacy-notice")
async def privacy_notice():
    return {"notice": PRIVACY_NOTICE, "regulator": "Nigeria Data Protection Commission (NDPC)"}


@router.get("/p/{token}", response_class=HTMLResponse, include_in_schema=False)
async def pass_page(token: str, request: Request):
    rate_limit(f"passpage:{ip_hash(request)}", 30, 60)
    payload = verify_pass(token)
    visit = await db.visits.find_one({"pass_token_hash": sha256_hex(token)}) if payload else None
    if not visit:
        raise HTTPException(404, "Pass not found or replaced")
    estate = await db.estates.find_one({"id": visit["estate_id"]})
    visitor = await db.visitors.find_one({"id": visit["visitor_id"]}) or {}
    tz = ZoneInfo(estate["timezone"])
    first = html.escape((visit.get("visitor_name") or visitor.get("full_name") or "Visitor").split()[0])
    fmt = "%a %d %b, %H:%M"
    svg = qrcode.make(token, image_factory=qrcode.image.svg.SvgPathImage, box_size=12, border=2).to_string(encoding="unicode")
    status = visit["status"] if not (visit["status"] == "active" and visit["valid_to"] < now()) else "expired"
    page = f"""<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>EstateGate pass</title>
<style>body{{font-family:-apple-system,Segoe UI,sans-serif;background:#F2F2F7;margin:0;padding:24px;color:#000}}
.card{{background:#fff;border-radius:20px;padding:24px;max-width:420px;margin:0 auto}}
.qr svg{{width:100%;height:auto}} h1{{font-size:22px;margin:0 0 4px}} .muted{{color:#8E8E93;font-size:14px}}
.badge{{display:inline-block;padding:4px 12px;border-radius:999px;background:#1A1A1A;color:#fff;font-size:12px;text-transform:uppercase}}
.notice{{font-size:12px;color:#3A3A3C;line-height:1.5;margin-top:16px}}</style></head>
<body><div class="card"><span class="badge">{html.escape(status)}</span><h1>Hi {first}, here is your gate pass</h1>
<p class="muted">{html.escape(estate['name'])} &middot; {visit['valid_from'].astimezone(tz).strftime(fmt)} – {visit['valid_to'].astimezone(tz).strftime(fmt)}</p>
<div class="qr">{svg}</div><p class="muted">Show this code to security at the gate. Reference: <b>{visit['ref_code']}</b></p>
<p class="notice"><b>Privacy notice.</b> {html.escape(PRIVACY_NOTICE)}</p></div></body></html>"""
    return HTMLResponse(page, headers={"Cache-Control": "no-store", "X-Robots-Tag": "noindex",
                                       "Referrer-Policy": "no-referrer"})


class PrivacyRequestIn(Strict):
    estate_code: str = Field(pattern=r"^[A-Za-z0-9]{2,12}$")
    type: Literal["access", "correction", "deletion"]
    contact: str = Field(min_length=5, max_length=120)
    details: str = Field(default="", max_length=500)


@router.post("/privacy/requests", status_code=201)
async def privacy_request(body: PrivacyRequestIn, request: Request):
    rate_limit(f"privacy:{ip_hash(request)}", 5, 3600)
    estate = await db.estates.find_one({"code": body.estate_code.upper()})
    if not estate:
        raise HTTPException(404, "Estate not found")
    await db.privacy_requests.insert_one({"id": new_id(), "estate_id": estate["id"], "type": body.type,
                                          "contact_encrypted": enc(body.contact), "details": body.details,
                                          "status": "received", "created_at": now()})
    return {"message": "Request received. The estate administrator must respond within the NDPA timelines."}
