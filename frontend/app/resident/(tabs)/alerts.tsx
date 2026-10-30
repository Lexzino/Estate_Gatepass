import Ionicons from "@react-native-vector-icons/ionicons";
import { useFocusEffect } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { fmtAgo } from "@/src/format";
import { usesNativeTabs } from "@/src/navigation";
import { pushState, PushState, registerForPush } from "@/src/push";
import { spacing, useTheme } from "@/src/theme";
import { Button, Card, EmptyState, Header, Skeleton, T } from "@/src/ui";

type Note = { id: string; kind: string; title: string; message: string; ref: any; read: boolean; created_at: string };

function PushCard() {
  const [state, setState] = useState<PushState | null>(null);
  useEffect(() => { pushState().then(setState); }, []);
  if (!state || state === "granted") return null;
  return (
    <Card testID="push-permission-card" style={{ gap: spacing.sm, marginBottom: spacing.md }}>
      <T variant="h3">Get check-in alerts</T>
      <T variant="caption">
        {state === "unsupported"
          ? "Phone alerts work in the installed app. Alerts still appear in this list."
          : "We'll notify you the moment a visitor arrives or a guard asks you to approve someone."}
      </T>
      {state === "blocked" ? (
        <Button testID="push-open-settings-button" title="Open Settings" variant="secondary" onPress={() => Linking.openSettings()} />
      ) : state !== "unsupported" ? (
        <Button testID="push-enable-button" title="Turn on alerts" onPress={async () => setState(await registerForPush(true))} />
      ) : null}
    </Card>
  );
}

export default function Alerts() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const router = useRouter();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["notifications"], queryFn: () => api<Note[]>("/residents/notifications"), refetchInterval: 15000 });
  useFocusEffect(useCallback(() => {
    const t = setTimeout(() => api("/residents/notifications/read-all", { body: {} }).then(() => qc.invalidateQueries({ queryKey: ["notifications"] })).catch(() => null), 1500);
    return () => clearTimeout(t);
  }, [qc]));

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}>
      <Header title="Alerts" subtitle="Check-ins and gate requests" />
      {q.isLoading ? <View style={{ padding: spacing.lg }}><Skeleton /></View> : (
        <FlatList
          testID="alerts-list"
          data={q.data ?? []}
          keyExtractor={(n) => n.id}
          ListHeaderComponent={<PushCard />}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: bottomChrome + spacing.xl }}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} />}
          renderItem={({ item }) => (
            <Card testID={`alert-${item.id}`} onPress={() => item.ref?.visit_id ? router.push(`/resident/pass/${item.ref.visit_id}` as any) : router.push("/resident")}
              style={{ flexDirection: "row", gap: spacing.md, alignItems: "center", opacity: item.read ? 0.75 : 1 }}>
              <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: item.kind === "check_in" ? colors.success : item.title === "Gate request handled" ? colors.brandSecondary : colors.warning }}>
                <Ionicons name={item.kind === "check_in" ? "log-in" : item.title === "Gate request handled" ? "checkmark-done" : "hand-left"} size={18} color={colors.onSuccess} />
              </View>
              <View style={{ flex: 1 }}>
                <T variant="h3">{item.title}</T>
                <T variant="caption">{item.message}</T>
              </View>
              <T variant="caption">{fmtAgo(item.created_at)}</T>
            </Card>
          )}
          ListEmptyComponent={<EmptyState testID="alerts-empty" icon="notifications-outline" title="No alerts yet" message="You'll see check-ins and visitor requests here." />}
        />
      )}
    </View>
  );
}
