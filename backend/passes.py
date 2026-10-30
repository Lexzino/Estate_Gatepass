"""Pure pass-evaluation rules (no I/O) so they are easy to unit-test and mirror on the guard device."""
from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

PASS_TYPES = ("one_time", "time_window", "recurring", "contractor")
VISIT_TYPES = ("family_friend", "delivery", "contractor", "domestic_staff", "other")
MAX_WINDOW = {
    "one_time": timedelta(hours=24),
    "time_window": timedelta(days=7),
    "recurring": timedelta(days=90),
    "contractor": timedelta(days=30),
}

RESULT_TO_EVENT = {
    "ALLOW": "allowed", "DENIED": "denied", "EXPIRED": "expired", "REVOKED": "revoked",
    "ALREADY_USED": "already_used", "NEEDS_REVIEW": "needs_review",
}


def _as_utc(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def validate_window(pass_type: str, valid_from: datetime, valid_to: datetime, now: datetime) -> Optional[str]:
    if pass_type not in PASS_TYPES:
        return "Unknown pass type"
    if valid_to <= valid_from:
        return "End time must be after start time"
    if valid_to <= now:
        return "End time must be in the future"
    if valid_from < now - timedelta(minutes=5):
        valid_from = now
    if valid_to - valid_from > MAX_WINDOW[pass_type]:
        return f"Window too long for {pass_type.replace('_', ' ')} pass"
    if valid_from - now > timedelta(days=60):
        return "Passes can be created at most 60 days ahead"
    return None


def in_schedule(schedule: Optional[dict], at: datetime, tz: str) -> bool:
    """schedule = {"days": [0..6 Mon=0], "start": "HH:MM", "end": "HH:MM"} in estate local time."""
    if not schedule:
        return True
    local = at.astimezone(ZoneInfo(tz))
    if schedule.get("days") and local.weekday() not in schedule["days"]:
        return False
    hhmm = local.strftime("%H:%M")
    start, end = schedule.get("start", "00:00"), schedule.get("end", "23:59")
    return start <= hhmm <= end


def evaluate(visit: dict, at: datetime, tz: str, gate_id: Optional[str] = None) -> tuple[str, Optional[str]]:
    """Return (RESULT, reason). Order matters: hard stops first."""
    status = visit.get("status")
    if status == "revoked":
        return "REVOKED", "PASS_REVOKED"
    if status == "pending":
        return "NEEDS_REVIEW", "PENDING_APPROVAL"
    if status == "expired" or at > _as_utc(visit["valid_to"]):
        return "EXPIRED", "PASS_EXPIRED"
    if status == "used" or visit.get("scan_count", 0) >= visit.get("max_scans", 1):
        return "ALREADY_USED", "MAX_ENTRIES_REACHED"
    if at < _as_utc(visit["valid_from"]):
        return "NEEDS_REVIEW", "NOT_YET_VALID"
    gates = visit.get("allowed_gate_ids") or []
    if gates and gate_id not in gates:
        return "DENIED", "GATE_NOT_PERMITTED"
    if visit.get("pass_type") in ("recurring", "contractor") and not in_schedule(visit.get("schedule"), at, tz):
        return "NEEDS_REVIEW", "OUTSIDE_SCHEDULE"
    return "ALLOW", None
