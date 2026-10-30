import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth";
import { fonts, makeStyles, radius, spacing, type, useTheme } from "@/src/theme";
import { Button, Chip, ChipRow, Field, T } from "@/src/ui";

const HERO = "https://images.unsplash.com/photo-1591474200742-8e512e6f98f8?crop=entropy&cs=srgb&fm=jpg&q=85&w=1200";
const DEMO = [
  { label: "Resident", id: "adaeze@estategate.ng", pw: "Resident@123!" },
  { label: "Guard", id: "+2348020000001", pw: "Guard@12345!" },
  { label: "Admin", id: "admin@estategate.ng", pw: "Admin@12345!" },
];

const ERRORS: Record<string, string> = {
  ACCOUNT_PENDING: "Your household is awaiting verification by the estate admin.",
  ACCOUNT_SUSPENDED: "This account is suspended. Contact your estate admin.",
  DEVICE_NOT_AUTHORIZED: "This guard account is bound to another device. Ask the admin to reset it.",
  DEVICE_REVOKED: "This device has been revoked by the estate admin.",
};

export default function Login() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { login, lostReason } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(lostReason === "DEVICE_REVOKED" ? ERRORS.DEVICE_REVOKED : "");

  const submit = async () => {
    if (!identifier.trim() || !password) return setError("Enter your email or phone and password.");
    setBusy(true);
    setError("");
    try {
      const u = await login(identifier.trim(), password);
      router.replace(`/${u.role}` as any);
    } catch (e: any) {
      setError(ERRORS[e.message] ?? e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.root}>
      <Image source={{ uri: HERO }} style={s.hero} contentFit="cover" transition={300} />
      <LinearGradient colors={["rgba(0,0,0,0.55)", "rgba(0,0,0,0.05)"]} style={s.hero} />
      <View style={[s.brandWrap, { paddingTop: insets.top + spacing.xl }]}>
        <Text style={s.brand} testID="login-brand">EstateGate</Text>
        <Text style={s.tag}>Secure visitor access for your estate</Text>
      </View>
      <KeyboardAwareScrollView bottomOffset={24} contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <View style={[s.card, { paddingBottom: insets.bottom + spacing.xl }]}>
          <T variant="h2">Sign in</T>
          <T variant="caption">Residents, guards and estate admins use the same app.</T>
          <View style={{ gap: spacing.lg, marginTop: spacing.lg }}>
            <Field testID="login-identifier-input" label="Email or phone" value={identifier} onChangeText={setIdentifier}
              autoCapitalize="none" keyboardType="email-address" placeholder="you@example.com or 0803…" autoComplete="username" />
            <Field testID="login-password-input" label="Password" value={password} onChangeText={setPassword}
              secureTextEntry placeholder="••••••••••" autoComplete="password" onSubmitEditing={submit} />
            {error ? <Text style={[s.error, { color: colors.error }]} testID="login-error">{error}</Text> : null}
            <Button testID="login-submit-button" title="Sign in" onPress={submit} loading={busy} />
            <View style={s.links}>
              <Pressable testID="login-register-link" onPress={() => router.push("/register")} hitSlop={8}>
                <Text style={s.link}>Register household</Text>
              </Pressable>
              <Pressable testID="login-forgot-link" onPress={() => router.push("/forgot")} hitSlop={8}>
                <Text style={s.link}>Forgot password?</Text>
              </Pressable>
            </View>
          </View>
          <View style={s.demo}>
            <T variant="label">Demo accounts</T>
          </View>
          <ChipRow style={{ marginHorizontal: -spacing.xl }}>
            {DEMO.map((d) => (
              <Chip key={d.label} testID={`login-demo-${d.label.toLowerCase()}`} label={d.label}
                onPress={() => { setIdentifier(d.id); setPassword(d.pw); setError(""); }} />
            ))}
          </ChipRow>
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surfaceInverse },
  hero: { position: "absolute", top: 0, left: 0, right: 0, height: 420 },
  brandWrap: { paddingHorizontal: spacing.xl },
  brand: { fontFamily: fonts.heavy, fontSize: 34, color: c.onSurfaceInverse, letterSpacing: -1 },
  tag: { fontFamily: fonts.semibold, fontSize: type.lg, color: c.onSurfaceInverse, opacity: 0.9, marginTop: spacing.xs },
  scroll: { flexGrow: 1, justifyContent: "flex-end", paddingTop: 200 },
  card: { backgroundColor: c.surface, borderTopLeftRadius: radius.lg + 8, borderTopRightRadius: radius.lg + 8, padding: spacing.xl, gap: spacing.xs },
  error: { fontFamily: fonts.semibold, fontSize: type.base },
  links: { flexDirection: "row", justifyContent: "space-between", paddingVertical: spacing.xs },
  link: { fontFamily: fonts.semibold, fontSize: type.base, color: c.onSurface, textDecorationLine: "underline" },
  demo: { marginTop: spacing.xl },
}));
