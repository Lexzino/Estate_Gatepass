import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { fmtAgo, fmtDateTime, PASS_TYPE_LABEL } from "@/src/format";
import { usesNativeTabs } from "@/src/navigation";
import { spacing, useTheme } from "@/src/theme";
import { Button, Card, EmptyState, Field, Header, Row, Segmented, Sheet, StatusBadge, T, useToast } from "@/src/ui";

type Tab = "incidents" | "visits" | "audit";
const PATH: Record<Tab, string> = { incidents: "/admin/reports/security-incidents", visits: "/admin/visits", audit: "/admin/audit-logs?limit=150" };
const title = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export default function Security() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("incidents");
  const [revealFor, setRevealFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [revealed, setRevealed] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ["admin-security", tab], queryFn: () => api<any[]>(PATH[tab]) });

  const resolve = async (id: string) => {
    try { await api(`/admin/incidents/${id}/resolve`, { body: {} }); q.refetch(); toast("Incident resolved", "success"); } catch (e: any) { toast(e.message, "error"); }
  };
  const verify = async () => {
    try {
      const r = await api<{ valid: boolean; entries?: number; broken_at_seq?: number }>("/admin/audit-logs/verify");
      toast(r.valid ? `Audit chain intact · ${r.entries} entries` : `Audit chain broken at #${r.broken_at_seq}`, r.valid ? "success" : "error");
    } catch (e: any) { toast(e.message, "error"); }
  };
  const reveal = async () => {
    setBusy(true);
    try {
      setRevealed(await api(`/admin/visits/${revealFor}/reveal`, { body: { reason } }));
    } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  };
  const closeReveal = () => { setRevealFor(null); setRevealed(null); setReason(""); };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}>
      <Header title="Security" subtitle="Incidents, visitor records and audit trail" />
      <View style={{ padding: spacing.lg, paddingBottom: 0 }}>
        <Segmented testID="security-segment" value={tab} onChange={(v) => setTab(v as Tab)}
          options={[{ value: "incidents", label: "Incidents" }, { value: "visits", label: "Visits" }, { value: "audit", label: "Audit log" }]} />
      </View>
      <FlatList
        testID="security-list"
        data={q.data ?? []}
        keyExtractor={(i) => i.id}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} />}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: bottomChrome + spacing.xl }}
        ListHeaderComponent={tab === "audit" ? <Button testID="audit-verify-button" title="Verify audit chain" variant="secondary" icon="link" onPress={verify} style={{ marginBottom: spacing.sm }} /> : null}
        ListEmptyComponent={q.isLoading ? null : <EmptyState testID="security-empty" icon="shield-checkmark-outline" title="Nothing to show" />}
        renderItem={({ item }) => {
          if (tab === "incidents")
            return (
              <Card testID={`incident-${item.id}`} style={{ gap: spacing.sm }}>
                <View style={{ flexDirection: "row", gap: spacing.md }}>
                  <View style={{ flex: 1 }}>
                    <T variant="h3">{title(item.type)}</T>
                    <T variant="caption">{item.details} · {item.gate ?? "Gate"} · {item.guard ?? "Guard"} · {fmtAgo(item.created_at)}</T>
                  </View>
                  <StatusBadge status={item.resolved ? "approved" : "needs_review"} />
                </View>
                {!item.resolved && <Button testID={`incident-resolve-${item.id}`} title="Mark reviewed" variant="secondary" onPress={() => resolve(item.id)} />}
              </Card>
            );
          if (tab === "visits")
            return (
              <Card testID={`admin-visit-${item.id}`} style={{ gap: spacing.sm }}>
                <View style={{ flexDirection: "row", gap: spacing.md }}>
                  <View style={{ flex: 1 }}>
                    <T variant="h3">{item.visitor} · {item.house_number}</T>
                    <T variant="caption">{PASS_TYPE_LABEL[item.pass_type]} · {fmtDateTime(item.valid_from)} · {item.scan_count}/{item.max_scans} · {item.ref_code}</T>
                  </View>
                  <StatusBadge status={item.status} />
                </View>
                <Button testID={`admin-visit-reveal-${item.id}`} title="View full details" variant="secondary" icon="eye-outline" onPress={() => setRevealFor(item.id)} />
              </Card>
            );
          return (
            <Card testID={`audit-${item.id}`} style={{ gap: 2 }}>
              <T variant="h3">#{item.seq} {title(item.action)}</T>
              <T variant="caption">{item.actor_role} · {fmtDateTime(item.created_at)}{item.entity_type ? ` · ${item.entity_type}` : ""}</T>
              {item.metadata?.reason ? <T variant="caption">Reason: {item.metadata.reason}</T> : null}
            </Card>
          );
        }}
      />
      <Sheet visible={!!revealFor} onClose={closeReveal} testID="reveal-sheet" title="View visitor personal data"
        message="Access to personal data is logged with your reason (NDPA 2023).">
        {revealed ? (
          <Card testID="reveal-result">
            <Row label="Name" value={revealed.visitor_name} />
            <Row label="Phone" value={revealed.visitor_phone} testID="reveal-phone" />
            <Row label="Vehicle" value={revealed.vehicle_plate} />
            <Row label="Purpose" value={revealed.purpose} />
          </Card>
        ) : (
          <>
            <Field testID="reveal-reason-input" label="Reason for access" value={reason} onChangeText={setReason} placeholder="Investigating incident at Back Gate" />
            <Button testID="reveal-confirm-button" title="Reveal and log access" onPress={reveal} loading={busy} disabled={reason.trim().length < 10} />
          </>
        )}
        <Button testID="reveal-close-button" title="Close" variant="secondary" onPress={closeReveal} />
      </Sheet>
    </View>
  );
}
