import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { GateSelector } from "@/src/components/GuardChrome";
import { fmtAgo } from "@/src/format";
import { useGuard } from "@/src/guard";
import { spacing, useTheme } from "@/src/theme";
import { Button, Card, Field, Header, StatusBadge, T, useToast } from "@/src/ui";

type Req = { id: string; visitor_name: string; house_number: string; status: string; ref_code?: string; created_at: string };

export default function WalkIn() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { gateId, scan } = useGuard();
  const [f, setF] = useState({ visitor_name: "", visitor_phone: "", house_number: "", purpose: "", vehicle_plate: "" });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));
  const reqs = useQuery({ queryKey: ["guard-requests"], queryFn: () => api<Req[]>("/guard/visitor-requests"), refetchInterval: 5000 });

  const submit = async () => {
    setBusy(true);
    try {
      await api("/guard/manual-override", { body: { ...f, purpose: f.purpose || undefined, vehicle_plate: f.vehicle_plate || undefined, gate_id: gateId } });
      toast("Request sent to the household", "success");
      setF({ visitor_name: "", visitor_phone: "", house_number: "", purpose: "", vehicle_plate: "" });
      reqs.refetch();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}>
      <Header title="Unexpected visitor" subtitle="Ask the resident to approve" onBack={() => router.back()} />
      <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}>
        <View style={{ marginHorizontal: -spacing.lg }}><GateSelector /></View>
        <Card style={{ gap: spacing.lg }}>
          <Field testID="walkin-name-input" label="Visitor name" value={f.visitor_name} onChangeText={set("visitor_name")} />
          <Field testID="walkin-phone-input" label="Visitor phone" value={f.visitor_phone} onChangeText={set("visitor_phone")} keyboardType="phone-pad" />
          <Field testID="walkin-house-input" label="House number they're visiting" value={f.house_number} onChangeText={set("house_number")} autoCapitalize="characters" placeholder="B12" />
          <Field testID="walkin-purpose-input" label="Purpose (optional)" value={f.purpose} onChangeText={set("purpose")} />
          <Field testID="walkin-plate-input" label="Vehicle plate (optional)" value={f.vehicle_plate} onChangeText={set("vehicle_plate")} autoCapitalize="characters" />
          <Button testID="walkin-submit-button" title="Send approval request" onPress={submit} loading={busy} disabled={!f.visitor_name || !f.visitor_phone || !f.house_number} />
        </Card>
        <T variant="label">Recent requests</T>
        {(reqs.data ?? []).map((r) => (
          <Card key={r.id} testID={`walkin-request-${r.id}`} style={{ gap: spacing.sm }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: spacing.md }}>
              <View style={{ flex: 1 }}>
                <T variant="h3">{r.visitor_name}</T>
                <T variant="caption">House {r.house_number} · {fmtAgo(r.created_at)}</T>
              </View>
              <StatusBadge status={r.status} testID={`walkin-request-status-${r.id}`} />
            </View>
            {r.status === "approved" && r.ref_code ? (
              <Button testID={`walkin-verify-${r.id}`} title="Verify & admit" variant="success" onPress={() => scan({ ref: r.ref_code }).catch((e) => toast(e.message, "error"))} />
            ) : null}
          </Card>
        ))}
        {reqs.data?.length === 0 ? <T variant="caption">No requests in the last 12 hours.</T> : null}
      </KeyboardAwareScrollView>
    </View>
  );
}
