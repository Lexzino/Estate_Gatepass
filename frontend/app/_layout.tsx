import { QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import * as Linking from "expo-linking";
import * as Notifications from "expo-notifications";
import { Stack, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { LogBox, Platform, StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";

import { AuthProvider, useAuth } from "@/src/auth";
import { ErrorBoundary } from "@/src/components/error-boundary";
import { registerForPush } from "@/src/push";
import { queryClient } from "@/src/query-client";
import { Button, Sheet, ToastProvider } from "@/src/ui";
import { storage } from "@/src/utils/storage";

// Disable logbox errors etc so that users can see the app
// and agent works as expected.
LogBox.ignoreAllLogs(true);

// Foreground push display — module scope
if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true,
    }),
  });
}
// Android channel — module scope, before any push arrives
if (Platform.OS === "android") {
  Notifications.setNotificationChannelAsync("default", {
    name: "Default", importance: Notifications.AndroidImportance.MAX, sound: "default",
  });
}

function PushBridge() {
  const router = useRouter();
  const { user } = useAuth();
  const [nudge, setNudge] = useState(false);

  useEffect(() => {
    if (Platform.OS === "web") return;
    const open = (data: any) => {
      const url = data?.deeplink || data?.action_url;
      if (!url) return;
      if (String(url).startsWith("http")) Linking.openURL(url);
      else router.push(url);
    };
    const sub = Notifications.addNotificationResponseReceivedListener((r) => open(r.notification.request.content.data));
    Notifications.getLastNotificationResponseAsync().then((r) => r && open(r.notification.request.content.data));
    return () => sub.remove();
  }, [router]);

  useEffect(() => {
    if (Platform.OS === "web" || user?.role !== "resident") return;
    registerForPush(false); // re-register on every open (tokens rotate); never prompts here
    (async () => {
      const { status, canAskAgain } = await Notifications.getPermissionsAsync();
      if (status !== "denied" || canAskAgain) return;
      const last = await storage.getItem<number | null>("pushNudgeAt", null);
      if (last && Date.now() - last <= 7 * 24 * 3600 * 1000) return;
      setNudge(true);
    })();
  }, [user]);

  const close = async (openSettings: boolean) => {
    await storage.setItem("pushNudgeAt", Date.now());
    setNudge(false);
    if (openSettings) Linking.openSettings();
  };

  return (
    <Sheet visible={nudge} onClose={() => close(false)} testID="push-nudge-sheet" title="Turn on check-in alerts"
      message="Notifications are off. Turn them on in Settings to know the moment your visitor arrives or asks to come in.">
      <Button testID="push-nudge-open-settings" title="Open Settings" onPress={() => close(true)} />
      <Button testID="push-nudge-later" title="Later" variant="secondary" onPress={() => close(false)} />
    </Sheet>
  );
}

export default function RootLayout() {
  const [loaded] = useFonts({
    "PJS-400": require("../assets/fonts/PlusJakartaSans-400.ttf"),
    "PJS-600": require("../assets/fonts/PlusJakartaSans-600.ttf"),
    "PJS-700": require("../assets/fonts/PlusJakartaSans-700.ttf"),
    "PJS-800": require("../assets/fonts/PlusJakartaSans-800.ttf"),
  });
  if (!loaded) return null;
  return (
    <GestureHandlerRootView style={styles.root}>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <KeyboardProvider>
            <AuthProvider>
              <ToastProvider>
                <Stack screenOptions={{ headerShown: false }} />
                <PushBridge />
              </ToastProvider>
            </AuthProvider>
          </KeyboardProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
