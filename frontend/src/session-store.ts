// In-memory only: raw pass tokens and the latest scan result are never persisted.
import type { ScanResult } from "@/src/offline";

export const passTokens = new Map<string, string>();

let lastScan: ScanResult | null = null;
export const setLastScan = (r: ScanResult) => { lastScan = r; };
export const getLastScan = () => lastScan;
