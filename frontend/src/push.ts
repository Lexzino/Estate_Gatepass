import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { api } from "@/src/api";

export type PushState = "granted" | "undetermined" | "denied" | "blocked" | "unsupported";

export async function pushState(): Promise<PushState> {
  if (Platform.OS === "web" || !Device.isDevice) return "unsupported";
  const p = await Notifications.getPermissionsAsync();
  if (p.status === "granted") return "granted";
  if (p.status === "denied") return p.canAskAgain ? "denied" : "blocked";
  return "undetermined";
}

/** Ask (only after user intent) and register the native device token with the backend relay. */
export async function registerForPush(ask: boolean): Promise<PushState> {
  let state = await pushState();
  if (state === "unsupported" || state === "blocked") return state;
  if (state !== "granted") {
    if (!ask) return state;
    const r = await Notifications.requestPermissionsAsync();
    if (r.status !== "granted") return r.canAskAgain ? "denied" : "blocked";
    state = "granted";
  }
  try {
    const token = await Notifications.getDevicePushTokenAsync();
    await api("/register-push", { body: { platform: Platform.OS, device_token: String(token.data) } });
  } catch {
    // Token fetch fails in Expo Go / without Firebase config; in-app alerts still work.
  }
  return state;
}
