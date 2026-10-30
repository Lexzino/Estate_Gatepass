import Ionicons from "@react-native-vector-icons/ionicons";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { usePreventScreenCapture } from "expo-screen-capture";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { ZoomIn } from "react-native-reanimated";

import { api } from "@/src/api";
import { fmtDateTime, PASS_TYPE_LABEL, REASON_LABEL } from "@/src/format";
import { useGuard } from "@/src/guard";
import { enqueue } from "@/src/offline";
import { getLastScan } from "@/src/session-store";
import { fonts, makeStyles, radius, spacing, type, useTheme } from "@/src/theme";
import { Button, useToast } from "@/src/ui";

const TITLES: Record<string, string> = {
  ALLOW: "ALLOW ENTRY", DENIED: "DENY ENTRY", EXPIRED: "EXPIRED", REVOKED: "REVOKED", ALREADY_USED: "ALREADY USED", NEEDS_REVIEW: "NEEDS REVIEW",
};
const ICONS: Record<string, any> = {
  ALLOW: "checkmark-circle", DENIED: "close-circle", EXPIRED: "time", REVOKED: "ban", ALREADY_USED: "repeat", NEEDS_REVIEW: "alert-circle",
};

// expo-screen-capture throws on web; Platform.OS is constant so the hook order stays stable
const usePreventCapture = Platform.OS === "web" ? () => {} : usePreventScreenCapture;

export default function ScanResultScreen() {
  usePreventCapture(); // visitor details on screen: block screenshots where supported
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { refreshPending } = useGuard();
  const r = getLastScan();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const logged = useRef(false);

  const isAllow = r?.result === "ALLOW";
  const bg = !r ? colors.surfaceInverse : isAllow ? colors.success : r.result === "DENIED" ? colors.error : colors.warning;

  // Offline non-allow results are logged locally right away so they upload later.
  useEffect(() => {
    if (r?.offline && !isAllow && !logged.current) {
      logged.current = true;
      enqueue({ token_hash: r.token_hash ?? null, gate_id: r.gate_id!, local_result: r.result, local_reason: r.reason ?? null,
        admitted: false, identity_confirmed: false, visitor_name: r.visitor_name, house_number: r.house_number }).then(refreshPending);
    }
  }, [r, isAllow, refreshPending]);

  const close = () => (router.canGoBack() ? router.back() : router.replace("/guard"));

  const decide = async (admit: boolean) => {
    if (!r) return;
    setBusy(admit ? "admit" : "refuse");
    try {
      if (r.offline) {
        await enqueue({ token_hash: r.token_hash ?? null, gate_id: r.gate_id!, local_result: r.result, local_reason: r.reason ?? null,
          admitted: admit, identity_confirmed: admit && confirmed, visitor_name: r.visitor_name, house_number: r.house_number });
        await refreshPending();
        toast(admit ? "Entry saved offline — will sync when online" : "Refusal saved offline", "success");
      } else {
        const res = await api<{ result: string }>("/guard/entry-confirm", { body: { scan_id: r.scan_id, decision: admit ? "admit" : "refuse", identity_confirmed: confirmed } });
        if (res.result === "ALREADY_USED") toast("Pass was just used at another gate — do not admit", "error");
        else toast(admit ? "Entry recorded. Resident notified." : "Refusal recorded", "success");
      }
      close();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(null);
    }
  };

  if (!r) {
    return (
      <View style={[s.root, { backgroundColor: bg, paddingTop: insets.top + spacing.xl }]}>
        <Button testID="result-dismiss-button" title="Back to scanner" onPress={close} variant="secondary" style={{ margin: spacing.lg }} />
      </View>
    );
  }

  return (
    <View style={[s.root, { backgroundColor: bg }]} testID={`scan-result-${r.result.toLowerCase()}`}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.xl, padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.lg }}>
        <Animated.View entering={ZoomIn.duration(250)} style={s.head}>
          <Ionicons name={ICONS[r.result]} size={88} color={colors.onSuccess} />
          <Text style={s.title} testID="scan-result-title">{TITLES[r.result]}</Text>
          {r.reason ? <Text style={s.reason} testID="scan-result-reason">{REASON_LABEL[r.reason] ?? r.reason}</Text> : null}
          {r.offline ? <View style={s.offlineTag}><Text style={s.offlineText}>Verified offline</Text></View> : null}
        </Animated.View>
        {r.visitor_name ? (
          <View style={s.card} testID="scan-result-card">
            <Text style={s.label}>Visitor</Text>
            <Text style={s.name} testID="scan-result-visitor-name">{r.visitor_name}</Text>
            <View style={s.grid}>
              <View style={s.cell}><Text style={s.label}>Host</Text><Text style={s.value} testID="scan-result-host">{r.host_name}</Text></View>
              <View style={s.cell}><Text style={s.label}>House</Text><Text style={s.valueBig} testID="scan-result-house">{r.house_number}</Text></View>
            </View>
            {isAllow ? (
              <View style={s.grid}>
                <View style={s.cell}><Text style={s.label}>Valid until</Text><Text style={s.value} testID="scan-result-valid-until">{fmtDateTime(r.valid_until)}</Text></View>
                <View style={s.cell}><Text style={s.label}>Pass</Text><Text style={s.value}>{PASS_TYPE_LABEL[r.pass_type ?? ""] ?? r.pass_type}</Text></View>
              </View>
            ) : null}
            {isAllow ? (
              <View style={s.grid}>
                <View style={s.cell}><Text style={s.label}>Vehicle</Text><Text style={s.value} testID="scan-result-plate">{r.vehicle_plate || "None"}</Text></View>
                <View style={s.cell}><Text style={s.label}>Entries left after</Text><Text style={s.value} testID="scan-result-remaining">{r.remaining_entries}</Text></View>
              </View>
            ) : null}
          </View>
        ) : null}
        {isAllow ? (
          <Pressable testID="scan-result-identity-checkbox" onPress={() => setConfirmed(!confirmed)} style={s.check}>
            <Ionicons name={confirmed ? "checkbox" : "square-outline"} size={30} color={colors.onSurface} />
            <Text style={s.checkText}>I have visually confirmed the visitor matches this name</Text>
          </Pressable>
        ) : null}
      </ScrollView>
      <View style={[s.actions, { paddingBottom: insets.bottom + spacing.lg }]}>
        {isAllow ? (
          <>
            <Button testID="scan-result-admit-button" title="Admit visitor" icon="log-in" onPress={() => decide(true)} disabled={!confirmed} loading={busy === "admit"} style={s.admit} />
            <Button testID="scan-result-refuse-button" title="Refuse entry" variant="secondary" onPress={() => decide(false)} loading={busy === "refuse"} />
          </>
        ) : (
          <Button testID="result-dismiss-button" title="Dismiss" variant="secondary" onPress={close} style={{ minHeight: 60 }} />
        )}
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1 },
  head: { alignItems: "center", gap: spacing.sm },
  title: { fontFamily: fonts.heavy, fontSize: 40, color: c.onSuccess, textAlign: "center", letterSpacing: -0.5 },
  reason: { fontFamily: fonts.bold, fontSize: type.lg, color: c.onSuccess, textAlign: "center" },
  offlineTag: { backgroundColor: c.surfaceInverse, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill },
  offlineText: { color: c.onSurfaceInverse, fontFamily: fonts.bold, fontSize: type.sm },
  card: { backgroundColor: c.surface, borderRadius: radius.lg, padding: spacing.xl, gap: spacing.md },
  label: { fontFamily: fonts.semibold, fontSize: type.sm, color: c.muted, textTransform: "uppercase", letterSpacing: 0.6 },
  name: { fontFamily: fonts.heavy, fontSize: 30, color: c.onSurface, letterSpacing: -0.5 },
  grid: { flexDirection: "row", gap: spacing.md },
  cell: { flex: 1, gap: 2 },
  value: { fontFamily: fonts.bold, fontSize: type.lg, color: c.onSurface },
  valueBig: { fontFamily: fonts.heavy, fontSize: 28, color: c.onSurface },
  check: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: c.surface, borderRadius: radius.lg, padding: spacing.lg },
  checkText: { flex: 1, fontFamily: fonts.bold, fontSize: type.lg, color: c.onSurface },
  actions: { paddingHorizontal: spacing.lg, gap: spacing.md },
  admit: { minHeight: 60, backgroundColor: c.brandPrimary },
}));
