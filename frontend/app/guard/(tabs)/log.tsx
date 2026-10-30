import Ionicons from "@react-native-vector-icons/ionicons";
import { useFocusEffect } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { ConnectionPill } from "@/src/components/GuardChrome";
import { fmtTime, STATUS_LABEL } from "@/src/format";
import { useGuard } from "@/src/guard";
import { usesNativeTabs } from "@/src/navigation";
import { loadQueue, QueueItem } from "@/src/offline";
import { spacing, useTheme } from "@/src/theme";
import { Button, Card, EmptyState, Header, StatusBadge, T, useToast } from "@/src/ui";

type Ev = { id: string; scanned_at: string; result: string; notes?: string; decision?: string; exit_at?: string; offline: boolean; gate: string; visitor_name?: string; house_number?: string };

export default function Log() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const toast = useToast();
  const { syncNow, syncing, online } = useGuard();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["scan-history"], queryFn: () => api<Ev[]>("/guard/scan-history"), enabled: online });
  useFocusEffect(useCallback(() => { loadQueue().then(setQueue); q.refetch(); }, [q.refetch]));  // eslint-disable-line react-hooks/exhaustive-deps

  const logExit = async (id: string) => {
    setBusy(id);
    try {
      await api("/guard/exit-event", { body: { scan_id: id } });
      toast("Exit logged", "success");
      q.refetch();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(null);
    }
  };
  const sync = async () => {
    const r = await syncNow();
    setQueue(await loadQueue());
    q.refetch();
    toast(r ? `Uploaded ${r.synced} scans${r.flagged ? ` · ${r.flagged} flagged for review` : ""}` : "Still offline", r ? "success" : "info");
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}>
      <Header title="Gate log" subtitle="Your scans in the last 24 hours" right={<ConnectionPill />} />
      <FlatList
        testID="guard-log-list"
        data={q.data ?? []}
        keyExtractor={(e) => e.id}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} />}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: bottomChrome + spacing.xl }}
        ListHeaderComponent={queue.length ? (
          <Card testID="offline-queue-card" style={{ gap: spacing.sm, marginBottom: spacing.sm, borderColor: colors.warning, borderWidth: 1.5 }}>
            <T variant="h3">{queue.length} scan{queue.length > 1 ? "s" : ""} waiting to sync</T>
            {queue.slice(0, 5).map((i) => (
              <T key={i.local_id} variant="caption">{fmtTime(i.scanned_at)} · {i.visitor_name ?? "Unknown pass"} · {i.admitted ? "admitted" : i.local_result.toLowerCase()}</T>
            ))}
            <Button testID="log-sync-button" title="Sync now" icon="cloud-upload-outline" onPress={sync} loading={syncing} />
          </Card>
        ) : null}
        ListEmptyComponent={<EmptyState testID="guard-log-empty" icon="list-outline" title={online ? "No scans yet" : "Offline"} message={online ? "Scanned passes appear here." : "History loads when you're back online."} />}
        renderItem={({ item }) => (
          <Card testID={`log-entry-${item.id}`} style={{ gap: spacing.sm }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
              <Ionicons name={item.decision === "admitted" ? "log-in" : "scan"} size={22} color={colors.onSurface} />
              <View style={{ flex: 1 }}>
                <T variant="h3">{item.visitor_name ?? "Unrecognised pass"}{item.house_number ? ` · ${item.house_number}` : ""}</T>
                <T variant="caption">{fmtTime(item.scanned_at)} · {item.gate}{item.offline ? " · offline" : ""}{item.exit_at ? ` · left ${fmtTime(item.exit_at)}` : ""}</T>
              </View>
              <StatusBadge status={item.decision === "admitted" ? "allowed" : item.decision === "refused" ? "denied" : item.result} />
            </View>
            {item.notes && item.result !== "allowed" ? <T variant="caption">{STATUS_LABEL[item.result] ?? item.result} · {item.notes}</T> : null}
            {item.decision === "admitted" && !item.exit_at ? (
              <Button testID={`log-exit-${item.id}`} title="Log exit" variant="secondary" icon="log-out-outline" onPress={() => logExit(item.id)} loading={busy === item.id} />
            ) : null}
          </Card>
        )}
      />
    </View>
  );
}
