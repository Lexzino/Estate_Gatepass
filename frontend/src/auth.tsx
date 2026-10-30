import * as Crypto from "expo-crypto";
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { Platform } from "react-native";

import { api, clearSession, getRefreshToken, onAuthLost, refreshSession, setSession } from "@/src/api";
import { wipeOffline } from "@/src/offline";
import { queryClient } from "@/src/query-client";
import { storage } from "@/src/utils/storage";

export type Role = "resident" | "guard" | "admin";
export type User = { id: string; role: Role; full_name: string; status: string; [k: string]: any };

type Ctx = {
  user: User | null;
  ready: boolean;
  lostReason: string | null;
  login: (identifier: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<Ctx>(null as unknown as Ctx);
const USER_KEY = "eg_user";

export async function getDeviceId(): Promise<string> {
  let id = await storage.secureGet<string | null>("eg_device_id", null);
  if (!id) {
    id = Crypto.randomUUID();
    await storage.secureSet("eg_device_id", id);
  }
  return id;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [lostReason, setLostReason] = useState<string | null>(null);

  const dropLocal = useCallback(async (wipe: boolean) => {
    await clearSession();
    await storage.removeItem(USER_KEY);
    if (wipe) await wipeOffline();
    queryClient.clear();
    setUser(null);
  }, []);

  useEffect(() => {
    onAuthLost((reason) => {
      setLostReason(reason);
      // Remote wipe: a revoked guard device deletes its offline pass cache and queue.
      dropLocal(reason === "DEVICE_REVOKED");
    });
    (async () => {
      const cachedRaw = await storage.getItem<string | null>(USER_KEY, null);
      const cached: User | null = cachedRaw ? JSON.parse(cachedRaw) : null;
      if (await getRefreshToken()) {
        const r = await refreshSession();
        if (r === "ok") {
          try {
            const me = await api<User>("/auth/me");
            setUser(me);
            await storage.setItem(USER_KEY, JSON.stringify(me));
          } catch {
            setUser(cached);
          }
        } else if (r === "offline" && cached) {
          setUser(cached); // gate keeps working offline with the last known profile
        }
      }
      setReady(true);
    })();
  }, [dropLocal]);

  const login = useCallback(async (identifier: string, password: string) => {
    const device_id = await getDeviceId();
    const res = await api<{ access_token: string; refresh_token: string; user: User }>("/auth/login", {
      body: { identifier, password, device_id, device_name: `${Platform.OS} device` },
    });
    await setSession(res.access_token, res.refresh_token);
    await storage.setItem(USER_KEY, JSON.stringify(res.user));
    setLostReason(null);
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(async () => {
    const rt = await getRefreshToken();
    if (rt) await api("/auth/logout", { body: { refresh_token: rt } }).catch(() => null);
    await dropLocal(true);
  }, [dropLocal]);

  return <AuthContext.Provider value={{ user, ready, lostReason, login, logout }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
