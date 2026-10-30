import Ionicons from "@react-native-vector-icons/ionicons";
import { View } from "react-native";

import { useGuard } from "@/src/guard";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { Chip, ChipRow, T } from "@/src/ui";

export function ConnectionPill({ onPress }: { onPress?: () => void }) {
  const s = useStyles();
  const { colors } = useTheme();
  const { online, pending, syncing } = useGuard();
  const bg = online ? colors.success : colors.warning;
  return (
    <View style={[s.pill, { backgroundColor: bg }]} testID="guard-connection-pill" onTouchEnd={onPress}>
      <Ionicons name={online ? "wifi" : "cloud-offline"} size={16} color={colors.onSuccess} />
      <T style={s.pillText} testID="guard-connection-status">
        {online ? "Online" : "Offline"}{pending ? ` · ${pending} pending sync` : ""}{syncing ? " · syncing…" : ""}
      </T>
    </View>
  );
}

export function GateSelector() {
  const { me, gateId, setGateId } = useGuard();
  return (
    <ChipRow>
      {(me?.gates ?? []).map((g) => (
        <Chip key={g.id} testID={`gate-chip-${g.name.toLowerCase().replace(/\s+/g, "-")}`} label={g.name} selected={gateId === g.id} onPress={() => setGateId(g.id)} />
      ))}
    </ChipRow>
  );
}

const useStyles = makeStyles((c) => ({
  pill: { flexDirection: "row", alignItems: "center", gap: spacing.xs + 2, alignSelf: "flex-start", paddingHorizontal: spacing.md, height: 32, borderRadius: radius.pill },
  pillText: { fontFamily: fonts.bold, fontSize: 13, color: c.onSuccess },
}));
