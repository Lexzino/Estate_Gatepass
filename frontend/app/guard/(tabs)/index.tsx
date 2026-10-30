import Ionicons from "@react-native-vector-icons/ionicons";
import { useFocusEffect } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ConnectionPill, GateSelector } from "@/src/components/GuardChrome";
import { useGuard } from "@/src/guard";
import { usesNativeTabs } from "@/src/navigation";
import { fonts, makeStyles, radius, spacing, type, useTheme } from "@/src/theme";
import { Button, Card, T, useToast } from "@/src/ui";

export default function Scanner() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const router = useRouter();
  const toast = useToast();
  const { scan, me, syncNow, refreshPending } = useGuard();
  const [perm, requestPerm] = useCameraPermissions();
  const [focused, setFocused] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [torch, setTorch] = useState(false);
  const lock = useRef(false);

  useFocusEffect(useCallback(() => {
    setFocused(true);
    lock.current = false;
    refreshPending();
    return () => setFocused(false);
  }, [refreshPending]));

  const onScanned = async ({ data }: { data: string }) => {
    if (lock.current) return;
    lock.current = true;
    setVerifying(true);
    try {
      await scan({ token: data });
    } catch (e: any) {
      toast(e.message, "error");
      setTimeout(() => { lock.current = false; }, 1500);
    } finally {
      setVerifying(false);
    }
  };

  const top = (
    <View style={[s.top, { paddingTop: insets.top + spacing.sm }]}>
      <View style={s.topRow}>
        <View style={{ flex: 1 }}>
          <Text style={s.estate} numberOfLines={1}>{me?.estate.name ?? "EstateGate"}</Text>
          <ConnectionPill />
        </View>
        <Pressable testID="scanner-sync-button" onPress={async () => { const r = await syncNow(); toast(r ? `Synced · ${r.synced} uploaded${r.flagged ? `, ${r.flagged} flagged` : ""}` : "Still offline — scans are saved", r ? "success" : "info"); }} style={s.roundBtn}>
          <Ionicons name="sync" size={22} color={colors.onSurface} />
        </Pressable>
      </View>
      <View style={{ marginHorizontal: -spacing.lg }}><GateSelector /></View>
    </View>
  );

  if (!perm) return <View style={s.dark}><ActivityIndicator color={colors.onSurfaceInverse} /></View>;

  if (!perm.granted) {
    return (
      <View style={[s.root, { backgroundColor: colors.surfaceSecondary }]}>
        {top}
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <Card style={{ gap: spacing.md }} testID="camera-permission-card">
            <Ionicons name="camera-outline" size={36} color={colors.onSurface} />
            <T variant="h2">Camera needed to scan passes</T>
            <T>EstateGate uses the camera only to read visitor QR codes at the gate. Nothing is recorded or stored.</T>
            {perm.canAskAgain ? (
              <Button testID="camera-allow-button" title="Allow camera" icon="camera" onPress={requestPerm} />
            ) : (
              <Button testID="camera-open-settings-button" title="Open Settings" icon="settings-outline" onPress={() => Linking.openSettings()} />
            )}
          </Card>
          <Button testID="scanner-manual-lookup-fallback" title="Manual lookup instead" variant="secondary" icon="search" onPress={() => router.push("/guard/lookup")} />
        </View>
      </View>
    );
  }

  return (
    <View style={s.dark}>
      {focused && (
        <CameraView style={s.camera} facing="back" enableTorch={torch} testID="scanner-camera"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={verifying ? undefined : onScanned} />
      )}
      <View style={s.overlay} pointerEvents="box-none">
        {top}
        <View style={s.cutoutWrap} pointerEvents="none">
          <View style={s.cutout}>
            <View style={[s.corner, { top: -3, left: -3, borderRightWidth: 0, borderBottomWidth: 0 }]} />
            <View style={[s.corner, { top: -3, right: -3, borderLeftWidth: 0, borderBottomWidth: 0 }]} />
            <View style={[s.corner, { bottom: -3, left: -3, borderRightWidth: 0, borderTopWidth: 0 }]} />
            <View style={[s.corner, { bottom: -3, right: -3, borderLeftWidth: 0, borderTopWidth: 0 }]} />
            {verifying && <View style={s.verifying}><ActivityIndicator color={colors.onSurfaceInverse} size="large" /><Text style={s.verifyingText}>Verifying…</Text></View>}
          </View>
          <Text style={s.hint}>Point at the visitor&apos;s QR pass</Text>
        </View>
        <View style={[s.bottom, { paddingBottom: bottomChrome + spacing.lg }]}>
          <Pressable testID="scanner-torch-button" onPress={() => setTorch(!torch)} style={s.roundBtnLg}>
            <Ionicons name={torch ? "flash" : "flash-outline"} size={24} color={colors.onSurface} />
          </Pressable>
          <Button testID="scanner-manual-lookup-button" title="Manual lookup" icon="search" variant="secondary" style={{ flex: 1 }} onPress={() => router.push("/guard/lookup")} />
        </View>
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1 },
  dark: { flex: 1, backgroundColor: c.surfaceInverse, justifyContent: "center" },
  camera: { ...{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 } },
  overlay: { flex: 1, justifyContent: "space-between" },
  top: { backgroundColor: c.surface, paddingHorizontal: spacing.lg, gap: spacing.xs },
  topRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  estate: { fontFamily: fonts.heavy, fontSize: type.xl, color: c.onSurface, marginBottom: spacing.xs },
  roundBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: c.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  roundBtnLg: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: c.surface, alignItems: "center", justifyContent: "center" },
  cutoutWrap: { alignItems: "center", gap: spacing.lg },
  cutout: { width: 260, height: 260, borderRadius: radius.lg, alignItems: "center", justifyContent: "center" },
  corner: { position: "absolute", width: 48, height: 48, borderColor: c.onSurfaceInverse, borderWidth: 6, borderRadius: 14 },
  verifying: { alignItems: "center", gap: spacing.sm, backgroundColor: c.scrim, padding: spacing.xl, borderRadius: radius.lg },
  verifyingText: { color: c.onSurfaceInverse, fontFamily: fonts.bold, fontSize: type.lg },
  hint: { color: c.onSurfaceInverse, fontFamily: fonts.bold, fontSize: type.lg, backgroundColor: c.scrim, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, overflow: "hidden" },
  bottom: { flexDirection: "row", gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, alignItems: "center" },
}));
