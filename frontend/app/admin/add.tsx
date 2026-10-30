import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { spacing, useTheme } from "@/src/theme";
import { Button, Field, Header, T, useToast } from "@/src/ui";

const FIELDS: Record<string, { k: string; l: string; secure?: boolean; kb?: any; caps?: any }[]> = {
  residents: [{ k: "full_name", l: "Full name" }, { k: "phone", l: "Phone", kb: "phone-pad" }, { k: "email", l: "Email", kb: "email-address", caps: "none" }, { k: "house_number", l: "House number", caps: "characters" }, { k: "password", l: "Temporary password", secure: true }],
  guards: [{ k: "full_name", l: "Full name" }, { k: "phone", l: "Phone (used to sign in)", kb: "phone-pad" }, { k: "password", l: "Temporary password", secure: true }],
  gates: [{ k: "name", l: "Gate name" }, { k: "location", l: "Location" }],
};

export default function AddEntity() {
  const { kind = "residents" } = useLocalSearchParams<{ kind: string }>();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const estates = useQuery({ queryKey: ["admin-estates"], queryFn: () => api<{ id: string }[]>("/admin/estates") });
  const [f, setF] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const label = kind === "residents" ? "resident" : kind === "guards" ? "guard" : "gate";

  const submit = async () => {
    setBusy(true);
    try {
      await api(`/admin/${kind}`, { body: { ...f, estate_id: estates.data?.[0]?.id } });
      toast(`${label[0].toUpperCase() + label.slice(1)} added`, "success");
      qc.invalidateQueries({ queryKey: ["admin-people"] });
      router.back();
    } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <Header title={`Add ${label}`} onBack={() => router.back()} />
      <KeyboardAwareScrollView bottomOffset={24} contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}>
        {(FIELDS[kind] ?? []).map((x) => (
          <Field key={x.k} testID={`add-${x.k}-input`} label={x.l} value={f[x.k] ?? ""} onChangeText={(v) => setF((p) => ({ ...p, [x.k]: v }))}
            secureTextEntry={x.secure} keyboardType={x.kb} autoCapitalize={x.caps} />
        ))}
        {kind === "guards" ? <T variant="caption">Each guard gets an individual account. The first phone they sign in on becomes their bound device.</T> : null}
        <Button testID="add-submit-button" title={`Add ${label}`} onPress={submit} loading={busy} />
      </KeyboardAwareScrollView>
    </View>
  );
}
