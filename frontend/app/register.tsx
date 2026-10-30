import Ionicons from "@react-native-vector-icons/ionicons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { spacing, useTheme } from "@/src/theme";
import { Button, Card, EmptyState, Field, Header, T, useToast } from "@/src/ui";

export default function Register() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const toast = useToast();
  const [f, setF] = useState({ full_name: "", phone: "", email: "", house_number: "", estate_code: "", password: "" });
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  const submit = async () => {
    if (!consent) return toast("Please accept the privacy notice", "error");
    setBusy(true);
    try {
      await api("/auth/register", { body: { ...f, estate_code: f.estate_code.toUpperCase() } });
      setDone(true);
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  if (done)
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top, justifyContent: "center" }}>
        <EmptyState testID="register-success" icon="shield-checkmark" title="Registration received"
          message="Your estate admin will verify your household. You can sign in once approved."
          action={<Button testID="register-back-to-login" title="Back to sign in" onPress={() => router.replace("/login")} style={{ alignSelf: "stretch", marginTop: spacing.lg }} />} />
      </View>
    );

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <Header title="Register household" subtitle="Residents only — guards are added by the admin" onBack={() => router.back()} />
      <KeyboardAwareScrollView bottomOffset={24} contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}>
        <Field testID="register-name-input" label="Full name" value={f.full_name} onChangeText={set("full_name")} placeholder="Adaeze Ade" />
        <Field testID="register-phone-input" label="Phone number" value={f.phone} onChangeText={set("phone")} keyboardType="phone-pad" placeholder="0803 000 0000" />
        <Field testID="register-email-input" label="Email" value={f.email} onChangeText={set("email")} keyboardType="email-address" autoCapitalize="none" placeholder="you@example.com" />
        <View style={{ flexDirection: "row", gap: spacing.md }}>
          <View style={{ flex: 1 }}><Field testID="register-house-input" label="House no." value={f.house_number} onChangeText={set("house_number")} autoCapitalize="characters" placeholder="B12" /></View>
          <View style={{ flex: 1 }}><Field testID="register-estate-input" label="Estate code" value={f.estate_code} onChangeText={set("estate_code")} autoCapitalize="characters" placeholder="LKG" /></View>
        </View>
        <Field testID="register-password-input" label="Password" value={f.password} onChangeText={set("password")} secureTextEntry placeholder="10+ chars, number & symbol" />
        <Card>
          <Pressable testID="register-consent-toggle" onPress={() => setConsent(!consent)} style={{ flexDirection: "row", gap: spacing.md, alignItems: "flex-start" }}>
            <Ionicons name={consent ? "checkbox" : "square-outline"} size={24} color={colors.onSurface} />
            <T style={{ flex: 1 }}>
              I understand EstateGate stores my name, house number, encrypted phone and email to manage visitor access, under the Nigeria Data Protection Act 2023. I can request access, correction or deletion at any time.
            </T>
          </Pressable>
        </Card>
        <Button testID="register-submit-button" title="Create account" onPress={submit} loading={busy} />
      </KeyboardAwareScrollView>
    </View>
  );
}
