import { storage } from "@/src/utils/storage";

export const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
export const API_URL = `${BASE_URL}/api`;
const RT_KEY = "eg_refresh_token";

let accessToken: string | null = null;
let authLost: ((reason: string) => void) | null = null;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function onAuthLost(fn: (reason: string) => void) {
  authLost = fn;
}

export async function setSession(access: string, refresh: string) {
  accessToken = access;
  await storage.secureSet(RT_KEY, refresh);
}

export async function clearSession() {
  accessToken = null;
  await storage.secureRemove(RT_KEY);
}

export async function getRefreshToken() {
  return storage.secureGet<string | null>(RT_KEY, null);
}

function messageFrom(data: any, status: number): string {
  const d = data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d) && d[0]?.msg) {
    const field = d[0].loc?.[d[0].loc.length - 1];
    return `${field ? String(field).replace(/_/g, " ") + ": " : ""}${String(d[0].msg).replace(/^Value error, /, "")}`;
  }
  return status === 429 ? "Too many attempts. Please wait." : "Request failed";
}

type RefreshResult = "ok" | "invalid" | "offline";
let refreshing: Promise<RefreshResult> | null = null;

export function refreshSession(): Promise<RefreshResult> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const rt = await getRefreshToken();
    if (!rt) return "invalid";
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: rt }),
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          const data = await res.json().catch(() => null);
          await clearSession();
          authLost?.(data?.detail === "DEVICE_REVOKED" ? "DEVICE_REVOKED" : "EXPIRED");
          return "invalid";
        }
        return "offline";
      }
      const j = await res.json();
      await setSession(j.access_token, j.refresh_token);
      return "ok";
    } catch {
      return "offline";
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const run = () =>
    fetch(`${API_URL}${path}`, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  let res: Response;
  try {
    res = await run();
    if (res.status === 401 && !path.startsWith("/auth/")) {
      const r = await refreshSession();
      if (r === "ok") res = await run();
    }
  } catch {
    throw new ApiError(0, "You appear to be offline");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 403 && data?.detail === "DEVICE_REVOKED" && !path.startsWith("/auth/")) {
      await clearSession();
      authLost?.("DEVICE_REVOKED");
    }
    throw new ApiError(res.status, messageFrom(data, res.status));
  }
  return data as T;
}
