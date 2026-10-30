import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { spacing, useTheme } from "@/src/theme";
import { Button, Card, Field, Header, T, useToast } from "@/src/ui";

export default function Forgot() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const toast = useToast();
  const [identifier, setIdentifier] = useState("");
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);

  const request = async () => {
    setBusy(true);
    try {
      const r = await api<{ message: string; dev_otp?: string }>("/auth/password-reset", { body: { identifier: identifier.trim() } });
      setSent(true);
      setDevCode(r.dev_otp ?? null);
      toast(r.message, "info");
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };
  const verify = async () => {
    setBusy(true);
    try {
      await api("/auth/verify-otp", { body: { identifier: identifier.trim(), otp, new_password: pw } });
      toast("Password updated. Sign in with your new password.", "success");
      router.replace("/login");
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <Header title="Reset password" onBack={() => router.back()} />
      <KeyboardAwareScrollView bottomOffset={24} contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}>
        <Field testID="forgot-identifier-input" label="Email or phone" value={identifier} onChangeText={setIdentifier} autoCapitalize="none" editable={!sent} />
        {!sent ? (
          <Button testID="forgot-send-code-button" title="Send code" onPress={request} loading={busy} />
        ) : (
          <>
            {devCode ? (
              <Card testID="forgot-dev-code"><T variant="label">Test mode code</T><T variant="h2">{devCode}</T><T variant="caption">SMS delivery isn&apos;t connected yet, so the code is shown here.</T></Card>
            ) : null}
            <Field testID="forgot-otp-input" label="6-digit code" value={otp} onChangeText={setOtp} keyboardType="number-pad" maxLength={6} />
            <Field testID="forgot-new-password-input" label="New password" value={pw} onChangeText={setPw} secureTextEntry placeholder="10+ chars, number & symbol" />
            <Button testID="forgot-verify-button" title="Update password" onPress={verify} loading={busy} />
          </>
        )}
      </KeyboardAwareScrollView>
    </View>
  );
}
