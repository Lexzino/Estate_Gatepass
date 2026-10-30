import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { PassCard, Visit } from "@/src/components/PassCard";
import { usesNativeTabs } from "@/src/navigation";
import { spacing, useTheme } from "@/src/theme";
import { Button, Chip, ChipRow, EmptyState, ErrorCard, Header, IconButton, Skeleton } from "@/src/ui";

const FILTERS = [
  { v: "", l: "All" }, { v: "active", l: "Active" }, { v: "used", l: "Used" },
  { v: "expired", l: "Expired" }, { v: "revoked", l: "Revoked" }, { v: "pending", l: "Pending" },
];

export default function Passes() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const router = useRouter();
  const [filter, setFilter] = useState("");
  const q = useQuery({ queryKey: ["visits"], queryFn: () => api<Visit[]>("/residents/visits") });
  const data = (q.data ?? []).filter((v) => !filter || v.status === filter);
  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}>
      <View style={{ backgroundColor: colors.surface }}>
        <Header title="Visitor passes" subtitle="Your household's passes and history"
          right={<IconButton testID="passes-invite-button" icon="add" onPress={() => router.push("/resident/invite")} />} />
        <ChipRow>
          {FILTERS.map((f) => (
            <Chip key={f.l} testID={`passes-filter-${f.l.toLowerCase()}`} label={f.l} selected={filter === f.v} onPress={() => setFilter(f.v)} />
          ))}
        </ChipRow>
      </View>
      {q.isLoading ? (
        <View style={{ padding: spacing.lg }}><Skeleton count={5} /></View>
      ) : q.error ? (
        <View style={{ padding: spacing.lg }}><ErrorCard message="Unable to load passes" onRetry={() => q.refetch()} /></View>
      ) : (
        <FlatList
          testID="passes-list"
          data={data}
          keyExtractor={(v) => v.id}
          renderItem={({ item }) => <PassCard v={item} />}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: bottomChrome + spacing.xl }}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} />}
          ListEmptyComponent={<EmptyState testID="passes-empty" icon="qr-code-outline" title="No passes here"
            message="Passes you create appear here with their live status."
            action={<Button testID="passes-empty-invite" title="Invite visitor" onPress={() => router.push("/resident/invite")} style={{ alignSelf: "stretch", marginTop: spacing.md }} />} />}
        />
      )}
    </View>
  );
}
