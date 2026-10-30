import type { ThemeColors } from "@/src/theme";

export const fmtDateTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

export const fmtTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "—";

export const fmtAgo = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
};

export const PASS_TYPE_LABEL: Record<string, string> = {
  one_time: "One-time", time_window: "Date range", recurring: "Recurring", contractor: "Contractor",
};
export const VISIT_TYPE_LABEL: Record<string, string> = {
  family_friend: "Family / friend", delivery: "Delivery", contractor: "Contractor", domestic_staff: "Domestic staff", other: "Other",
};
export const STATUS_LABEL: Record<string, string> = {
  active: "Active", used: "Used", expired: "Expired", revoked: "Revoked", pending: "Pending Approval",
  approved: "Approved", rejected: "Rejected", suspended: "Suspended", unbound: "No device", allowed: "Allowed",
  denied: "Denied", already_used: "Already used", needs_review: "Needs review",
};

export function statusColors(status: string, c: ThemeColors): { bg: string; fg: string } {
  switch (status) {
    case "active": case "approved": case "allowed":
      return { bg: c.successSoft, fg: c.onSurface };
    case "expired": case "pending": case "needs_review": case "already_used": case "unbound":
      return { bg: c.warningSoft, fg: c.onSurface };
    case "revoked": case "rejected": case "denied": case "suspended":
      return { bg: c.errorSoft, fg: c.onSurface };
    default:
      return { bg: c.surfaceTertiary, fg: c.onSurfaceTertiary };
  }
}

export const REASON_LABEL: Record<string, string> = {
  PASS_REVOKED: "The resident revoked this pass", PASS_EXPIRED: "This pass has expired",
  MAX_ENTRIES_REACHED: "All allowed entries have been used", NOT_YET_VALID: "Pass is not valid yet",
  PENDING_APPROVAL: "Waiting for resident approval", GATE_NOT_PERMITTED: "Not valid at this gate",
  OUTSIDE_SCHEDULE: "Outside the approved days or hours", INVALID_SIGNATURE: "Not a genuine EstateGate pass",
  WRONG_ESTATE: "Pass belongs to another estate", UNKNOWN_PASS: "Pass not found or replaced",
  NOT_IN_OFFLINE_CACHE: "Not in offline list — call the resident", NO_OFFLINE_CACHE: "Offline list not downloaded yet",
};
