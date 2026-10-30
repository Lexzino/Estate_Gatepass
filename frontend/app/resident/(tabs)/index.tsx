import Ionicons from "@react-native-vector-icons/ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { PassCard, Visit } from "@/src/components/PassCard";
import { fmtAgo } from "@/src/format";
import { usesNativeTabs } from "@/src/navigation";
import { fonts, makeStyles, radius, spacing, type, useTheme } from "@/src/theme";
import { Button, Card, EmptyState, ErrorCard, IconButton, Skeleton, T, useToast } from "@/src/ui";

type Req = { id: string; visitor_name: string; visitor_phone_masked: string; purpose?: string; vehicle_plate?: string; gate: string; status: string; created_at: string };

export default function ResidentHome() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [acting, setActing] = useState<string | null>(null);

  const visits = useQuery({ queryKey: ["visits"], queryFn: () => api<Visit[]>("/residents/visits"), refetchInterval: 30000 });
  const reqs = useQuery({ queryKey: ["requests"], queryFn: () => api<Req[]>("/residents/visitor-requests"), refetchInterval: 10000 });
  const notes = useQuery({ queryKey: ["notifications"], queryFn: () => api<any[]>("/residents/notifications"), refetchInterval: 30000 });
  const unread = (notes.data ?? []).filter((n) => !n.read).length;
  const pending = (reqs.data ?? []).filter((r) => r.status === "pending");
  const active = (visits.data ?? []).filter((v) => v.status === "active");

  const decide = async (id: string, action: "approve" | "reject") => {
    setActing(id + action);
    try {
      await api(`/residents/visitor-requests/${id}/${action}`, { body: {} });
      toast(action === "approve" ? "Visitor approved — the guard can let them in" : "Request rejected", action === "approve" ? "success" : "info");
      qc.invalidateQueries({ queryKey: ["requests"] });
      qc.invalidateQueries({ queryKey: ["visits"] });
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setActing(null);
    }
  };
  const refresh = () => Promise.all([visits.refetch(), reqs.refetch(), notes.refetch()]);
  const first = user?.full_name?.split(" ")[0] ?? "";

  return (
    <View style={s.root}>
      <View style={[s.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={{ flex: 1 }}>
          <T variant="caption">House {user?.house_number}</T>
          <T variant="title" testID="resident-greeting">Hello, {first}</T>
        </View>
        <IconButton testID="resident-alerts-button" icon="notifications-outline" badge={unread} onPress={() => router.push("/resident/alerts")} />
      </View>
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: bottomChrome + spacing.xl }]}
        refreshControl={<RefreshControl refreshing={visits.isRefetching} onRefresh={refresh} />}>
        {pending.length > 0 && (
          <View style={{ gap: spacing.md }} testID="visitor-requests-section">
            <T variant="label">At the gate now</T>
            {pending.map((r, i) => (
              <Animated.View key={r.id} entering={FadeInDown.delay(i * 60)}>
                <Card style={s.reqCard} testID={`visitor-request-${r.id}`}>
                  <View style={s.reqTop}>
                    <View style={[s.reqIcon, { backgroundColor: colors.warning }]}><Ionicons name="hand-left" size={18} color={colors.onWarning} /></View>
                    <View style={{ flex: 1 }}>
                      <T variant="h3">{r.visitor_name}</T>
                      <T variant="caption">{r.gate} · {fmtAgo(r.created_at)} · {r.visitor_phone_masked}</T>
                      {r.purpose ? <T variant="caption">“{r.purpose}”</T> : null}
                    </View>
                  </View>
                  <View style={s.reqActions}>
                    <Button testID={`request-reject-${r.id}`} title="Reject" variant="secondary" style={{ flex: 1 }} loading={acting === r.id + "reject"} onPress={() => decide(r.id, "reject")} />
                    <Button testID={`request-approve-${r.id}`} title="Approve" variant="success" style={{ flex: 1 }} loading={acting === r.id + "approve"} onPress={() => decide(r.id, "approve")} />
                  </View>
                </Card>
              </Animated.View>
            ))}
          </View>
        )}

        <Pressable testID="invite-visitor-cta" onPress={() => router.push("/resident/invite")} style={({ pressed }) => [s.cta, pressed && { transform: [{ scale: 0.98 }] }]}>
          <View style={{ flex: 1, gap: spacing.xs }}>
            <T style={s.ctaTitle}>Invite a visitor</T>
            <T style={s.ctaSub}>Create a secure QR pass and share it in seconds</T>
          </View>
          <View style={s.ctaIcon}><Ionicons name="add" size={28} color={colors.onSurface} /></View>
        </Pressable>

        <View style={s.statsRow}>
          <Card style={s.stat} testID="stat-active-passes"><T variant="title">{active.length}</T><T variant="caption">Active passes</T></Card>
          <Card style={s.stat} testID="stat-used-passes"><T variant="title">{(visits.data ?? []).filter((v) => v.status === "used").length}</T><T variant="caption">Visits completed</T></Card>
        </View>

        <View style={s.sectionHead}>
          <T variant="label">Active passes</T>
          <Pressable testID="see-all-passes" onPress={() => router.push("/resident/passes")} hitSlop={8}><T style={s.link}>See all</T></Pressable>
        </View>
        {visits.isLoading ? <Skeleton /> : visits.error ? (
          <ErrorCard message="Unable to load passes" onRetry={() => visits.refetch()} />
        ) : active.length === 0 ? (
          <Card><EmptyState testID="no-active-passes" icon="shield-checkmark-outline" title="No active passes" message="Invite a visitor and they'll show up here." /></Card>
        ) : (
          active.slice(0, 5).map((v, i) => (
            <Animated.View key={v.id} entering={FadeInDown.delay(i * 50)}><PassCard v={v} /></Animated.View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surfaceSecondary },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, backgroundColor: c.surface, borderBottomWidth: 0.5, borderBottomColor: c.border },
  content: { padding: spacing.lg, gap: spacing.md },
  cta: { backgroundColor: c.brandPrimary, borderRadius: radius.lg, padding: spacing.xl, flexDirection: "row", alignItems: "center", gap: spacing.lg },
  ctaTitle: { fontFamily: fonts.heavy, fontSize: type.xl, color: c.onBrandPrimary },
  ctaSub: { fontFamily: fonts.regular, fontSize: type.base, color: c.onBrandPrimary, opacity: 0.75 },
  ctaIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: c.surface, alignItems: "center", justifyContent: "center" },
  statsRow: { flexDirection: "row", gap: spacing.md },
  stat: { flex: 1, gap: 2 },
  sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.sm },
  link: { fontFamily: fonts.semibold, color: c.onSurface, textDecorationLine: "underline" },
  reqCard: { gap: spacing.md, borderColor: c.warning, borderWidth: 1.5 },
  reqTop: { flexDirection: "row", gap: spacing.md },
  reqIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  reqActions: { flexDirection: "row", gap: spacing.md },
}));
