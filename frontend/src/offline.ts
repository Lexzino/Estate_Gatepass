// Guard offline mode: encrypted minimal pass cache + encrypted scan queue.
// Signature check uses the estate's Ed25519 public key only; private keys never leave the server.
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { bytesToUtf8, utf8ToBytes } from "@noble/ciphers/utils.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import * as Crypto from "expo-crypto";

import { api } from "@/src/api";
import { storage } from "@/src/utils/storage";

const KEY = "eg_cache_key";
const CACHE = "eg_offline_cache";
const QUEUE = "eg_offline_queue";
const USED = "eg_offline_used";

export type OfflinePass = {
  h: string; vn: string; hn: string; house: string; f: string; t: string;
  max: number; count: number; type: string; gates: string[];
  sch?: { days: number[]; start: string; end: string } | null;
};
export type OfflineCache = {
  estate_id: string; estate_code: string; timezone: string; public_keys: Record<string, string>;
  generated_at: string; expires_at: string; passes: OfflinePass[];
};
export type QueueItem = {
  local_id: string; token_hash: string | null; gate_id: string; scanned_at: string;
  local_result: string; local_reason: string | null; admitted: boolean; identity_confirmed: boolean;
  visitor_name?: string; house_number?: string;
};
export type ScanResult = {
  result: "ALLOW" | "DENIED" | "EXPIRED" | "REVOKED" | "ALREADY_USED" | "NEEDS_REVIEW";
  reason?: string | null; scan_id?: string; visitor_name?: string; host_name?: string; house_number?: string;
  valid_until?: string; vehicle_plate?: string | null; pass_type?: string; remaining_entries?: number;
  offline?: boolean; token_hash?: string | null; gate_id?: string;
};

// ---- base64 (no Buffer/atob dependency)
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function b64encode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? B64[n & 63] : "=";
  }
  return out;
}
function b64decode(s: string): Uint8Array {
  const clean = s.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  const out: number[] = [];
  let buf = 0, bits = 0;
  for (const c of clean) {
    const v = B64.indexOf(c);
    if (v < 0) throw new Error("bad base64");
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 255);
    }
  }
  return new Uint8Array(out);
}

export const tokenHash = (token: string) => bytesToHex(sha256(utf8ToBytes(token.trim())));

// ---- encrypted storage (XChaCha20-Poly1305, key in Keychain/Keystore)
async function key(): Promise<Uint8Array> {
  let k = await storage.secureGet<string | null>(KEY, null);
  if (!k) {
    k = b64encode(Crypto.getRandomBytes(32));
    await storage.secureSet(KEY, k);
  }
  return b64decode(k);
}
async function writeEnc(name: string, value: unknown) {
  const nonce = Crypto.getRandomBytes(24);
  const box = xchacha20poly1305(await key(), nonce).encrypt(utf8ToBytes(JSON.stringify(value)));
  await storage.setItem(name, `${b64encode(nonce)}.${b64encode(box)}`);
}
async function readEnc<T>(name: string, fallback: T): Promise<T> {
  const raw = await storage.getItem<string | null>(name, null);
  if (!raw) return fallback;
  try {
    const [n, b] = raw.split(".");
    return JSON.parse(bytesToUtf8(xchacha20poly1305(await key(), b64decode(n)).decrypt(b64decode(b))));
  } catch {
    return fallback;
  }
}

export const loadCache = () => readEnc<OfflineCache | null>(CACHE, null);
export const loadQueue = () => readEnc<QueueItem[]>(QUEUE, []);
const loadUsed = () => readEnc<Record<string, number>>(USED, {});

export async function syncCache(): Promise<OfflineCache> {
  const pending = (await loadQueue()).length;
  const data = await api<OfflineCache>(`/guard/offline-passes?pending=${pending}`);
  await writeEnc(CACHE, data);
  // Server counts are authoritative only for synced scans; keep local counts for admissions still queued.
  const queued: Record<string, number> = {};
  for (const i of await loadQueue()) {
    if (i.admitted && i.token_hash) queued[i.token_hash] = (queued[i.token_hash] ?? 0) + 1;
  }
  await writeEnc(USED, queued);
  return data;
}

export async function enqueue(item: Omit<QueueItem, "local_id" | "scanned_at">) {
  const q = await loadQueue();
  q.push({ ...item, local_id: Crypto.randomUUID(), scanned_at: new Date().toISOString() });
  await writeEnc(QUEUE, q);
  if (item.admitted && item.token_hash) {
    const used = await loadUsed();
    used[item.token_hash] = (used[item.token_hash] ?? 0) + 1;
    await writeEnc(USED, used);
  }
}

export async function flushQueue(): Promise<{ synced: number; flagged: number }> {
  const q = await loadQueue();
  if (!q.length) return { synced: 0, flagged: 0 };
  const items = q.map(({ visitor_name, house_number, ...rest }) => rest);
  const res = await api<{ synced: number; flagged: number; results: { local_id: string }[] }>(
    "/guard/scan/offline-sync", { body: { items } });
  const done = new Set(res.results.map((r) => r.local_id));
  const remaining = (await loadQueue()).filter((i) => !done.has(i.local_id));
  await writeEnc(QUEUE, remaining);
  return { synced: res.synced, flagged: res.flagged };
}

export async function wipeOffline() {
  await storage.removeItem(CACHE);
  await storage.removeItem(QUEUE);
  await storage.removeItem(USED);
  await storage.secureRemove(KEY);
}

function inSchedule(sch: OfflinePass["sch"], tz: string): boolean {
  if (!sch) return true;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date());
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const day = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday"));
    const hhmm = `${get("hour").replace("24", "00")}:${get("minute")}`;
    if (sch.days?.length && !sch.days.includes(day)) return false;
    return sch.start <= hhmm && hhmm <= sch.end;
  } catch {
    return false;
  }
}

/** Mirror of the server rules, using only the minimal cache. */
export async function evaluateOffline(token: string, gateId: string): Promise<ScanResult> {
  const cache = await loadCache();
  const base = { offline: true, gate_id: gateId };
  if (!cache) return { ...base, result: "NEEDS_REVIEW", reason: "NO_OFFLINE_CACHE", token_hash: null };
  let payload: any;
  try {
    const [prefix, body, sig] = token.trim().split(".");
    payload = JSON.parse(bytesToUtf8(b64decode(body)));
    const pk = cache.public_keys[payload.k];
    if (prefix !== "EG1" || !pk || !ed25519.verify(b64decode(sig), utf8ToBytes(body), b64decode(pk))) throw new Error();
  } catch {
    return { ...base, result: "DENIED", reason: "INVALID_SIGNATURE", token_hash: null };
  }
  const h = tokenHash(token);
  if (payload.ec !== cache.estate_code) return { ...base, result: "DENIED", reason: "WRONG_ESTATE", token_hash: h };
  const p = cache.passes.find((x) => x.h === h);
  if (!p) return { ...base, result: "NEEDS_REVIEW", reason: "NOT_IN_OFFLINE_CACHE", token_hash: h };
  const who = { visitor_name: p.vn, host_name: p.hn, house_number: p.house, token_hash: h };
  const now = Date.now();
  const used = (await loadUsed())[h] ?? 0;
  if (now > Date.parse(p.t)) return { ...base, ...who, result: "EXPIRED", reason: "PASS_EXPIRED" };
  if (p.count + used >= p.max) return { ...base, ...who, result: "ALREADY_USED", reason: "MAX_ENTRIES_REACHED" };
  if (now < Date.parse(p.f)) return { ...base, ...who, result: "NEEDS_REVIEW", reason: "NOT_YET_VALID" };
  if (p.gates.length && !p.gates.includes(gateId)) return { ...base, ...who, result: "DENIED", reason: "GATE_NOT_PERMITTED" };
  if ((p.type === "recurring" || p.type === "contractor") && !inSchedule(p.sch, cache.timezone))
    return { ...base, ...who, result: "NEEDS_REVIEW", reason: "OUTSIDE_SCHEDULE" };
  return { ...base, ...who, result: "ALLOW", valid_until: p.t, pass_type: p.type,
    remaining_entries: Math.max(0, p.max - p.count - used - 1) };
}
