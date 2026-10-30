import Ionicons from "@react-native-vector-icons/ionicons";
import { useRouter } from "expo-router";
import { View } from "react-native";

import { fmtDateTime, PASS_TYPE_LABEL } from "@/src/format";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";
import { Card, StatusBadge, T } from "@/src/ui";

export type Visit = {
  id: string; ref_code: string; visitor_name: string; visitor_phone_masked?: string; visit_type: string; pass_type: string;
  valid_from: string; valid_to: string; max_scans: number; scan_count: number; remaining_entries: number;
  vehicle_plate?: string | null; purpose?: string | null; status: string; schedule?: any; created_by_role?: string;
};

export function PassCard({ v }: { v: Visit }) {
  const s = useStyles();
  const router = useRouter();
  const { colors } = useTheme();
  return (
    <Card testID={`pass-card-${v.id}`} onPress={() => router.push(`/resident/pass/${v.id}` as any)} style={s.card}>
      <View style={s.icon}><Ionicons name="person" size={20} color={colors.onSurface} /></View>
      <View style={{ flex: 1, gap: 2 }}>
        <T variant="h3" numberOfLines={1}>{v.visitor_name}</T>
        <T variant="caption" numberOfLines={1}>{PASS_TYPE_LABEL[v.pass_type]} · {fmtDateTime(v.valid_from)}</T>
        <T variant="caption" style={s.ref}>{v.ref_code} · {v.scan_count}/{v.max_scans} entries</T>
      </View>
      <StatusBadge status={v.status} testID={`pass-status-${v.id}`} />
    </Card>
  );
}

const useStyles = makeStyles((c) => ({
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  icon: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  ref: { fontFamily: fonts.semibold, color: c.onSurfaceTertiary },
}));
