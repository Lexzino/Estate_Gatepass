import NetInfo from "@react-native-community/netinfo";
import { useRouter } from "expo-router";
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";

import { api, ApiError } from "@/src/api";
import { evaluateOffline, flushQueue, loadCache, loadQueue, ScanResult, syncCache, tokenHash } from "@/src/offline";
import { setLastScan } from "@/src/session-store";
import { storage } from "@/src/utils/storage";

type Gate = { id: string; name: string; location?: string };
type GuardMe = { id: string; full_name: string; estate: { id: string; name: string; code: string; timezone: string }; gates: Gate[] };

type Ctx = {
  me: GuardMe | null; gateId: string | null; setGateId: (id: string) => void; online: boolean; pending: number;
  cacheInfo: { count: number; generated_at?: string } | null; syncing: boolean;
  syncNow: () => Promise<{ synced: number; flagged: number } | null>; refreshPending: () => Promise<void>;
  scan: (input: { token?: string; ref?: string }) => Promise<void>;
};
const GuardCtx = createContext<Ctx>(null as unknown as Ctx);
export const useGuard = () => useContext(GuardCtx);

export function GuardProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<GuardMe | null>(null);
  const [gateId, setGate] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [cacheInfo, setCacheInfo] = useState<Ctx["cacheInfo"]>(null);
  const wasOnline = useRef(true);

  const refreshPending = useCallback(async () => {
    setPending((await loadQueue()).length);
    const c = await loadCache();
    setCacheInfo(c ? { count: c.passes.length, generated_at: c.generated_at } : null);
  }, []);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    try {
      const r = await flushQueue();
      await syncCache();
      return r;
    } catch {
      return null;
    } finally {
      await refreshPending();
      setSyncing(false);
    }
  }, [refreshPending]);

  useEffect(() => {
    (async () => {
      const saved = await storage.getItem<string | null>("eg_guard_gate", null);
      const cached = await storage.getItem<string | null>("eg_guard_me", null);
      if (cached) setMe(JSON.parse(cached));
      try {
        const m = await api<GuardMe>("/guard/me");
        setMe(m);
        await storage.setItem("eg_guard_me", JSON.stringify(m));
        setGate(saved && m.gates.some((g) => g.id === saved) ? saved : m.gates[0]?.id ?? null);
      } catch {
        if (cached) setGate(saved ?? JSON.parse(cached).gates[0]?.id ?? null);
      }
      await syncNow();
    })();
    const unsub = NetInfo.addEventListener((st) => {
      const on = !!st.isConnected && st.isInternetReachable !== false;
      setOnline(on);
      if (on && !wasOnline.current) syncNow(); // connectivity back: upload queue + refresh cache
      wasOnline.current = on;
    });
    const t = setInterval(() => { if (wasOnline.current) syncNow(); }, 10 * 60 * 1000);
    return () => { unsub(); clearInterval(t); };
  }, [syncNow]);

  const setGateId = (id: string) => {
    setGate(id);
    storage.setItem("eg_guard_gate", id);
  };

  const scan = useCallback(async ({ token, ref }: { token?: string; ref?: string }) => {
    if (!gateId) throw new Error("Select your gate first");
    let result: ScanResult;
    try {
      if (!online) throw new ApiError(0, "offline");
      result = await api<ScanResult>("/guard/scan", { body: { token, ref, gate_id: gateId } });
      result.token_hash = token ? tokenHash(token) : null;
    } catch (e: any) {
      if (!(e instanceof ApiError) || e.status !== 0) throw e;
      if (!token) throw new Error("Reference lookups need internet. Scan the QR code instead.");
      result = await evaluateOffline(token, gateId);
    }
    result.gate_id = gateId;
    setLastScan(result);
    router.push("/guard/result");
  }, [gateId, online, router]);

  return (
    <GuardCtx.Provider value={{ me, gateId, setGateId, online, pending, cacheInfo, syncing, syncNow, refreshPending, scan }}>
      {children}
    </GuardCtx.Provider>
  );
}
