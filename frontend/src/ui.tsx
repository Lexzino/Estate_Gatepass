import Ionicons from "@react-native-vector-icons/ionicons";
import * as Haptics from "expo-haptics";
import { createContext, ReactNode, useCallback, useContext, useRef, useState } from "react";
import {
  ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleProp, Text, TextInput, TextInputProps, View, ViewStyle,
} from "react-native";
import Animated, { FadeInDown, FadeOutUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { STATUS_LABEL, statusColors } from "@/src/format";
import { fonts, makeStyles, radius, spacing, type, useTheme } from "@/src/theme";

export type IconName = React.ComponentProps<typeof Ionicons>["name"];

// ------------------------------------------------------------------ text
export function T({ style, variant = "body", children, testID, numberOfLines }: {
  style?: any; variant?: "title" | "h2" | "h3" | "body" | "caption" | "label"; children: ReactNode; testID?: string; numberOfLines?: number;
}) {
  const s = useStyles();
  return <Text testID={testID} numberOfLines={numberOfLines} style={[s[`t_${variant}`], style]}>{children}</Text>;
}

// ------------------------------------------------------------------ header
export function Header({ title, subtitle, onBack, right, testID }: {
  title: string; subtitle?: string; onBack?: () => void; right?: ReactNode; testID?: string;
}) {
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  return (
    <View style={[s.header, { paddingTop: insets.top + spacing.sm }]} testID={testID}>
      <View style={s.headerRow}>
        {onBack ? (
          <Pressable testID="header-back-button" onPress={onBack} hitSlop={8} style={s.iconBtn}>
            <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }}>
          <T variant="title" numberOfLines={1}>{title}</T>
          {subtitle ? <T variant="caption" numberOfLines={1}>{subtitle}</T> : null}
        </View>
        {right}
      </View>
    </View>
  );
}

export function IconButton({ icon, onPress, testID, badge }: { icon: IconName; onPress: () => void; testID: string; badge?: number }) {
  const s = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable testID={testID} onPress={onPress} hitSlop={6} style={({ pressed }) => [s.iconBtn, s.iconBtnFilled, pressed && { opacity: 0.6 }]}>
      <Ionicons name={icon} size={22} color={colors.onSurface} />
      {badge ? <View style={s.badgeDot}><Text style={s.badgeDotText}>{badge > 9 ? "9+" : badge}</Text></View> : null}
    </Pressable>
  );
}

// ------------------------------------------------------------------ button
export function Button({ title, onPress, variant = "primary", loading, disabled, icon, testID, style }: {
  title: string; onPress: () => void; variant?: "primary" | "secondary" | "destructive" | "ghost" | "success";
  loading?: boolean; disabled?: boolean; icon?: IconName; testID: string; style?: StyleProp<ViewStyle>;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const bg = { primary: colors.brandPrimary, secondary: colors.surfaceTertiary, destructive: colors.error, ghost: "transparent", success: colors.success }[variant];
  const fg = { primary: colors.onBrandPrimary, secondary: colors.onSurface, destructive: colors.onError, ghost: colors.error, success: colors.onSuccess }[variant];
  return (
    <Pressable
      testID={testID}
      disabled={disabled || loading}
      onPress={() => {
        if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] }, style]}
    >
      {loading ? <ActivityIndicator color={fg} /> : (
        <>
          {icon ? <Ionicons name={icon} size={20} color={fg} /> : null}
          <Text style={[s.btnText, { color: fg }]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

// ------------------------------------------------------------------ inputs
export function Field({ label, error, testID, ...props }: TextInputProps & { label: string; error?: string; testID: string }) {
  const s = useStyles();
  const { colors } = useTheme();
  const [focus, setFocus] = useState(false);
  return (
    <View style={s.field}>
      <T variant="label">{label}</T>
      <TextInput
        testID={testID}
        placeholderTextColor={colors.muted}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={[s.input, focus && { borderColor: colors.borderStrong, backgroundColor: colors.surface }]}
        {...props}
      />
      {error ? <T variant="caption" style={{ color: colors.error }} testID={`${testID}-error`}>{error}</T> : null}
    </View>
  );
}

// ------------------------------------------------------------------ chips
export function Chip({ label, selected, onPress, testID }: { label: string; selected?: boolean; onPress: () => void; testID: string }) {
  const s = useStyles();
  return (
    <Pressable testID={testID} onPress={onPress} style={[s.chip, selected && s.chipOn]}>
      <Text style={[s.chipText, selected && s.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

export function ChipRow({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const s = useStyles();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[s.chipRow, style]} contentContainerStyle={s.chipRowContent}>
      {children}
    </ScrollView>
  );
}

export function Segmented({ options, value, onChange, testID }: {
  options: { value: string; label: string }[]; value: string; onChange: (v: string) => void; testID: string;
}) {
  const s = useStyles();
  return (
    <View style={s.seg} testID={testID}>
      {options.map((o) => (
        <Pressable key={o.value} testID={`${testID}-${o.value}`} onPress={() => onChange(o.value)} style={[s.segItem, value === o.value && s.segItemOn]}>
          <Text numberOfLines={1} style={[s.segText, value === o.value && s.segTextOn]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

// ------------------------------------------------------------------ cards & states
export function Card({ children, style, onPress, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; testID?: string }) {
  const s = useStyles();
  if (onPress)
    return (
      <Pressable testID={testID} onPress={onPress} style={({ pressed }) => [s.card, style, pressed && { opacity: 0.85 }]}>
        {children}
      </Pressable>
    );
  return <View testID={testID} style={[s.card, style]}>{children}</View>;
}

export function StatusBadge({ status, testID }: { status: string; testID?: string }) {
  const s = useStyles();
  const { colors } = useTheme();
  const c = statusColors(status, colors);
  return (
    <View testID={testID} style={[s.badge, { backgroundColor: c.bg }]}>
      <Text style={[s.badgeText, { color: c.fg }]}>{STATUS_LABEL[status] ?? status}</Text>
    </View>
  );
}

export function EmptyState({ icon, title, message, action, testID }: { icon: IconName; title: string; message?: string; action?: ReactNode; testID?: string }) {
  const s = useStyles();
  const { colors } = useTheme();
  return (
    <View style={s.empty} testID={testID}>
      <View style={s.emptyIcon}><Ionicons name={icon} size={28} color={colors.onSurface} /></View>
      <T variant="h3" style={{ textAlign: "center" }}>{title}</T>
      {message ? <T variant="caption" style={{ textAlign: "center" }}>{message}</T> : null}
      {action}
    </View>
  );
}

export function ErrorCard({ message, onRetry, testID = "error-card" }: { message: string; onRetry: () => void; testID?: string }) {
  const s = useStyles();
  return (
    <Card style={s.errorCard} testID={testID}>
      <T variant="h3">Something went wrong</T>
      <T variant="caption">{message}</T>
      <Button testID={`${testID}-retry`} title="Retry" variant="secondary" onPress={onRetry} />
    </Card>
  );
}

export function Skeleton({ height = 72, count = 3 }: { height?: number; count?: number }) {
  const s = useStyles();
  return <View style={{ gap: spacing.md }}>{Array.from({ length: count }).map((_, i) => <View key={i} style={[s.skeleton, { height }]} />)}</View>;
}

export function Row({ label, value, testID }: { label: string; value?: string | number | null; testID?: string }) {
  const s = useStyles();
  return (
    <View style={s.kv}>
      <T variant="caption">{label}</T>
      <T style={s.kvValue} testID={testID}>{value ?? "—"}</T>
    </View>
  );
}

// ------------------------------------------------------------------ bottom sheet (confirm / reason)
export function Sheet({ visible, onClose, title, message, children, testID }: {
  visible: boolean; onClose: () => void; title: string; message?: string; children?: ReactNode; testID: string;
}) {
  const s = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.scrim} onPress={onClose} testID={`${testID}-backdrop`} />
      <View style={[s.sheet, { paddingBottom: insets.bottom + spacing.lg }]} testID={testID}>
        <View style={s.grabber} />
        <T variant="h2">{title}</T>
        {message ? <T variant="caption" style={{ marginTop: spacing.xs }}>{message}</T> : null}
        <View style={{ gap: spacing.md, marginTop: spacing.lg }}>{children}</View>
      </View>
    </Modal>
  );
}

// ------------------------------------------------------------------ toast
type ToastKind = "success" | "error" | "info";
const ToastCtx = createContext<(msg: string, kind?: ToastKind) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<{ msg: string; kind: ToastKind; id: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((msg: string, kind: ToastKind = "info") => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ msg, kind, id: Date.now() });
    timer.current = setTimeout(() => setToast(null), 3200);
  }, []);
  const bg = toast?.kind === "error" ? colors.error : toast?.kind === "success" ? colors.success : colors.surfaceInverse;
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {toast ? (
        <Animated.View key={toast.id} entering={FadeInDown} exiting={FadeOutUp} pointerEvents="none"
          style={[s.toast, { top: insets.top + spacing.sm, backgroundColor: bg }]} testID="toast">
          <Text style={s.toastText} testID="toast-message">{toast.msg}</Text>
        </Animated.View>
      ) : null}
    </ToastCtx.Provider>
  );
}

// ------------------------------------------------------------------ styles
const useStyles = makeStyles((c) => ({
  t_title: { fontFamily: fonts.heavy, fontSize: type["2xl"], color: c.onSurface, letterSpacing: -0.4 },
  t_h2: { fontFamily: fonts.bold, fontSize: type.xl, color: c.onSurface, letterSpacing: -0.2 },
  t_h3: { fontFamily: fonts.bold, fontSize: type.lg, color: c.onSurface },
  t_body: { fontFamily: fonts.regular, fontSize: type.base, color: c.onSurfaceSecondary, lineHeight: 20 },
  t_caption: { fontFamily: fonts.regular, fontSize: type.sm + 1, color: c.muted, lineHeight: 18 },
  t_label: { fontFamily: fonts.semibold, fontSize: type.sm, color: c.onSurfaceTertiary, textTransform: "uppercase", letterSpacing: 0.6 },
  header: { backgroundColor: c.surface, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 0.5, borderBottomColor: c.border },
  headerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44 },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill },
  iconBtnFilled: { backgroundColor: c.surfaceSecondary },
  badgeDot: { position: "absolute", top: 4, right: 4, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: c.error, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  badgeDotText: { color: c.onError, fontSize: 10, fontFamily: fonts.bold },
  btn: { minHeight: 52, borderRadius: radius.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingHorizontal: spacing.lg },
  btnText: { fontFamily: fonts.bold, fontSize: type.lg },
  field: { gap: spacing.xs + 2 },
  input: { minHeight: 50, borderRadius: radius.md, backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.surfaceSecondary, paddingHorizontal: spacing.lg, fontFamily: fonts.regular, fontSize: type.lg, color: c.onSurface },
  chipRow: { flexGrow: 0, height: 56 },
  chipRowContent: { gap: spacing.sm, paddingHorizontal: spacing.lg, alignItems: "center" },
  chip: { height: 36, flexShrink: 0, paddingHorizontal: spacing.lg, borderRadius: radius.pill, backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.border, justifyContent: "center" },
  chipOn: { backgroundColor: c.brandPrimary, borderColor: c.brandPrimary },
  chipText: { fontFamily: fonts.semibold, fontSize: type.base, color: c.onSurface },
  chipTextOn: { color: c.onBrandPrimary },
  seg: { flexDirection: "row", backgroundColor: c.surfaceTertiary, borderRadius: radius.md, padding: 3 },
  segItem: { flex: 1, minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: radius.md - 3, paddingHorizontal: spacing.xs },
  segItemOn: { backgroundColor: c.surface, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  segText: { fontFamily: fonts.semibold, fontSize: type.sm + 1, color: c.onSurfaceTertiary },
  segTextOn: { color: c.onSurface },
  card: { backgroundColor: c.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 0.5, borderColor: c.border, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  badge: { alignSelf: "flex-start", paddingHorizontal: spacing.sm + 2, paddingVertical: 3, borderRadius: radius.pill },
  badgeText: { fontFamily: fonts.bold, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 },
  empty: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing["2xl"], paddingHorizontal: spacing.xl },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: c.surfaceTertiary, alignItems: "center", justifyContent: "center", marginBottom: spacing.sm },
  errorCard: { gap: spacing.sm },
  skeleton: { borderRadius: radius.lg, backgroundColor: c.surfaceTertiary, opacity: 0.6 },
  kv: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: spacing.sm + 2, borderBottomWidth: 0.5, borderBottomColor: c.border, gap: spacing.md },
  kvValue: { fontFamily: fonts.semibold, color: c.onSurface, flexShrink: 1, textAlign: "right" },
  scrim: { flex: 1, backgroundColor: c.scrim },
  sheet: { backgroundColor: c.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.xl, paddingTop: spacing.md },
  grabber: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: c.borderStrong, marginBottom: spacing.lg },
  toast: { position: "absolute", left: spacing.lg, right: spacing.lg, borderRadius: radius.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  toastText: { color: c.onSurfaceInverse, fontFamily: fonts.semibold, fontSize: type.base },
}));
