import { useQuery } from "@tanstack/react-query";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { fmtAgo } from "@/src/format";
import { usesNativeTabs } from "@/src/navigation";
import { fonts, makeStyles, radius, spacing, type, useTheme } from "@/src/theme";
import { Card, ErrorCard, Header, Skeleton, StatusBadge, T } from "@/src/ui";

type Overview = { estate: { name: string; code: string }; residents: number; pending_residents: number; active_passes: number; entries_today: number; denied_today: number; open_incidents: number; pending_syncs: number; guards_active: number };
type Day = { date: string; entries: number; denied: number; scans: number };

export default function AdminOverview() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const ov = useQuery({ queryKey: ["admin-overview"], queryFn: () => api<Overview>("/admin/overview"), refetchInterval: 30000 });
  const traffic = useQuery({ queryKey: ["admin-traffic"], queryFn: () => api<Day[]>("/admin/reports/visitor-traffic?days=7") });
  const inc = useQuery({ queryKey: ["admin-incidents"], queryFn: () => api<any[]>("/admin/reports/security-incidents") });
  const max = Math.max(1, ...(traffic.data ?? []).map((d) => Math.max(d.entries, d.denied)));
  const o = ov.data;
  const metrics = o ? [
    { k: "entries_today", l: "Entries today", v: o.entries_today },
    { k: "denied_today", l: "Denied today", v: o.denied_today, alert: o.denied_today > 0 },
    { k: "active_passes", l: "Active passes", v: o.active_passes },
    { k: "residents", l: "Residents", v: o.residents, sub: o.pending_residents ? `${o.pending_residents} awaiting approval` : undefined },
    { k: "pending_syncs", l: "Pending syncs", v: o.pending_syncs, alert: o.pending_syncs > 0 },
    { k: "open_incidents", l: "Open incidents", v: o.open_incidents, alert: o.open_incidents > 0 },
  ] : [];

  return (
    <View style={s.root}>
      <Header title={o?.estate.name ?? "Estate overview"} subtitle={o ? `Code ${o.estate.code} · ${o.guards_active} guard devices active` : undefined} />
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: bottomChrome + spacing.xl }]}
        refreshControl={<RefreshControl refreshing={ov.isRefetching} onRefresh={() => { ov.refetch(); traffic.refetch(); inc.refetch(); }} />}>
        {ov.isLoading ? <Skeleton height={90} count={3} /> : ov.error ? <ErrorCard message="Unable to load overview" onRetry={() => ov.refetch()} /> : (
          <View style={s.grid}>
            {metrics.map((m, i) => (
              <Animated.View key={m.k} entering={FadeInDown.delay(i * 40)} style={s.metricWrap}>
                <Card style={s.metric} testID={`metric-${m.k}`}>
                  <Text style={[s.metricVal, m.alert && { color: m.k === "pending_syncs" ? colors.warning : colors.error }]}>{m.v}</Text>
                  <T variant="caption">{m.l}</T>
                  {m.sub ? <T variant="caption" style={{ color: colors.warning }}>{m.sub}</T> : null}
                </Card>
              </Animated.View>
            ))}
          </View>
        )}

        <Card style={{ gap: spacing.md }} testID="traffic-chart">
          <View style={s.chartHead}>
            <T variant="h3">Visitor traffic · 7 days</T>
            <View style={s.legend}>
              <View style={[s.dot, { backgroundColor: colors.brandPrimary }]} /><T variant="caption">Entries</T>
              <View style={[s.dot, { backgroundColor: colors.error }]} /><T variant="caption">Denied</T>
            </View>
          </View>
          <View style={s.chart}>
            {(traffic.data ?? []).map((d) => (
              <View key={d.date} style={s.barCol}>
                <View style={s.bars}>
                  <View style={[s.bar, { height: `${(d.entries / max) * 100}%`, backgroundColor: colors.brandPrimary }]} />
                  <View style={[s.bar, { height: `${(d.denied / max) * 100}%`, backgroundColor: colors.error }]} />
                </View>
                <Text style={s.barLabel}>{new Date(d.date).toLocaleDateString("en-GB", { weekday: "narrow" })}</Text>
              </View>
            ))}
          </View>
        </Card>

        <T variant="label">Recent security incidents</T>
        {(inc.data ?? []).slice(0, 5).map((i) => (
          <Card key={i.id} style={s.incident} testID={`overview-incident-${i.id}`}>
            <View style={{ flex: 1 }}>
              <T variant="h3">{i.type.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c: string) => c.toUpperCase())}</T>
              <T variant="caption">{i.gate ?? "Gate"} · {i.guard ?? "Guard"} · {fmtAgo(i.created_at)}</T>
            </View>
            <StatusBadge status={i.resolved ? "approved" : "needs_review"} />
          </Card>
        ))}
        {inc.data?.length === 0 ? <T variant="caption">No incidents recorded.</T> : null}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surfaceSecondary },
  content: { padding: spacing.lg, gap: spacing.md },
  grid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -spacing.xs },
  metricWrap: { width: "50%", padding: spacing.xs },
  metric: { gap: 2, minHeight: 96 },
  metricVal: { fontFamily: fonts.heavy, fontSize: 30, color: c.onSurface, letterSpacing: -0.5 },
  chartHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: spacing.sm },
  legend: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  dot: { width: 10, height: 10, borderRadius: 5, marginLeft: spacing.sm },
  chart: { flexDirection: "row", height: 150, alignItems: "flex-end", gap: spacing.sm },
  barCol: { flex: 1, height: "100%", alignItems: "center", gap: spacing.xs },
  bars: { flex: 1, width: "100%", flexDirection: "row", alignItems: "flex-end", justifyContent: "center", gap: 3, backgroundColor: c.surfaceSecondary, borderRadius: radius.sm, overflow: "hidden", paddingHorizontal: 3 },
  bar: { width: 10, borderTopLeftRadius: 4, borderTopRightRadius: 4, minHeight: 2 },
  barLabel: { fontFamily: fonts.semibold, fontSize: type.sm, color: c.muted },
  incident: { flexDirection: "row", alignItems: "center", gap: spacing.md },
}));
