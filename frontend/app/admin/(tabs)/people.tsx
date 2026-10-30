import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { fmtAgo } from "@/src/format";
import { usesNativeTabs } from "@/src/navigation";
import { spacing, useTheme } from "@/src/theme";
import { Button, Card, EmptyState, Field, Header, IconButton, Segmented, Sheet, StatusBadge, T, useToast } from "@/src/ui";

type Tab = "residents" | "guards" | "gates";

export default function People() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("residents");
  const [action, setAction] = useState<{ kind: "revoke" | "reset"; id: string; name: string } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["admin-people", tab], queryFn: () => api<any[]>(`/admin/${tab}`) });

  const setStatus = async (id: string, status: string) => {
    setBusy(id);
    try {
      await api(`/admin/residents/${id}/status`, { body: { status } });
      toast(status === "active" ? "Resident approved" : "Resident suspended and signed out", "success");
      q.refetch();
    } catch (e: any) { toast(e.message, "error"); } finally { setBusy(null); }
  };
  const deviceAction = async () => {
    if (!action) return;
    setBusy("device");
    try {
      await api(`/admin/devices/${action.id}/${action.kind}`, { body: { reason } });
      toast(action.kind === "revoke" ? "Device revoked — sessions ended and offline data will be wiped" : "Device binding reset", "success");
      setAction(null);
      setReason("");
      q.refetch();
    } catch (e: any) { toast(e.message, "error"); } finally { setBusy(null); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}>
      <Header title="People & gates" right={<IconButton testID="people-add-button" icon="add" onPress={() => router.push(`/admin/add?kind=${tab}` as any)} />} />
      <View style={{ padding: spacing.lg, paddingBottom: 0, backgroundColor: colors.surfaceSecondary }}>
        <Segmented testID="people-segment" value={tab} onChange={(v) => setTab(v as Tab)}
          options={[{ value: "residents", label: "Residents" }, { value: "guards", label: "Guards" }, { value: "gates", label: "Gates" }]} />
      </View>
      <FlatList
        testID="people-list"
        data={q.data ?? []}
        keyExtractor={(i) => i.id}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} />}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: bottomChrome + spacing.xl }}
        ListEmptyComponent={q.isLoading ? null : <EmptyState testID="people-empty" icon="people-outline" title={`No ${tab} yet`} />}
        renderItem={({ item }) => (
          <Card testID={`${tab}-row-${item.id}`} style={{ gap: spacing.sm }}>
            <View style={{ flexDirection: "row", gap: spacing.md, alignItems: "center" }}>
              <View style={{ flex: 1 }}>
                <T variant="h3">{item.full_name ?? item.name}</T>
                <T variant="caption">
                  {tab === "residents" && `House ${item.house_number} · ${item.phone_masked}`}
                  {tab === "guards" && `${item.phone_masked} · ${item.device_name ?? "no device"}${item.last_active_at ? ` · active ${fmtAgo(item.last_active_at)}` : ""}${item.pending_sync_count ? ` · ${item.pending_sync_count} pending` : ""}`}
                  {tab === "gates" && (item.location || "—")}
                </T>
              </View>
              <StatusBadge status={tab === "guards" ? item.device_status : item.status} testID={`${tab}-status-${item.id}`} />
            </View>
            {tab === "residents" && item.status === "pending" && (
              <Button testID={`resident-approve-${item.id}`} title="Verify & approve" variant="success" loading={busy === item.id} onPress={() => setStatus(item.id, "active")} />
            )}
            {tab === "residents" && item.status === "active" && (
              <Button testID={`resident-suspend-${item.id}`} title="Suspend" variant="secondary" loading={busy === item.id} onPress={() => setStatus(item.id, "suspended")} />
            )}
            {tab === "residents" && item.status === "suspended" && (
              <Button testID={`resident-reactivate-${item.id}`} title="Reactivate" variant="secondary" loading={busy === item.id} onPress={() => setStatus(item.id, "active")} />
            )}
            {tab === "guards" && (
              <View style={{ flexDirection: "row", gap: spacing.md }}>
                {item.device_status === "active" && <Button testID={`guard-revoke-${item.id}`} title="Revoke device" variant="destructive" style={{ flex: 1 }} onPress={() => setAction({ kind: "revoke", id: item.id, name: item.full_name })} />}
                {item.device_status !== "unbound" && <Button testID={`guard-reset-${item.id}`} title="Reset device" variant="secondary" style={{ flex: 1 }} onPress={() => setAction({ kind: "reset", id: item.id, name: item.full_name })} />}
              </View>
            )}
          </Card>
        )}
      />
      <Sheet visible={!!action} onClose={() => setAction(null)} testID="device-action-sheet"
        title={action?.kind === "revoke" ? `Revoke ${action?.name}'s device?` : `Reset ${action?.name}'s device?`}
        message={action?.kind === "revoke" ? "Ends all sessions now. The phone wipes its offline pass list on next contact." : "Unbinds the current phone so the guard can sign in on a new one."}>
        <Field testID="device-action-reason-input" label="Reason (logged)" value={reason} onChangeText={setReason} placeholder="Phone reported lost at night shift" />
        <Button testID="device-action-confirm-button" title={action?.kind === "revoke" ? "Revoke device" : "Reset device"} variant={action?.kind === "revoke" ? "destructive" : "primary"}
          onPress={deviceAction} loading={busy === "device"} disabled={reason.trim().length < 10} />
        <T variant="caption">Reason must be at least 10 characters.</T>
      </Sheet>
    </View>
  );
}
