import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { ConnectionPill } from "@/src/components/GuardChrome";
import { fmtDateTime, PASS_TYPE_LABEL } from "@/src/format";
import { useGuard } from "@/src/guard";
import { usesNativeTabs } from "@/src/navigation";
import { spacing, useTheme } from "@/src/theme";
import { Button, Card, EmptyState, Field, Header, StatusBadge, T, useToast } from "@/src/ui";

type Match = { ref_code: string; visitor_name: string; host_name: string; house_number: string; pass_type: string; valid_from: string; valid_to: string; status: string };
const REF = /^EG-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

export default function Lookup() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const router = useRouter();
  const toast = useToast();
  const { scan } = useGuard();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [matches, setMatches] = useState<Match[] | null>(null);
  // Results go stale once a pass is admitted elsewhere; clear them whenever the tab regains focus.
  useFocusEffect(useCallback(() => { setMatches(null); }, []));
  const search = async () => {
    const v = q.trim();
    if (!v) return;
    setBusy(true);
    try {
      if (v.startsWith("EG1.")) return await scan({ token: v });
      const ref = v.toUpperCase();
      setMatches(await api<Match[]>("/guard/manual-lookup", { body: REF.test(ref) ? { ref } : { phone: v } }));
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };
  const verify = async (ref: string) => {
    try { await scan({ ref }); } catch (e: any) { toast(e.message, "error"); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}>
      <Header title="Manual lookup" subtitle="Visitor phone or pass reference" right={<ConnectionPill />} />
      <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: bottomChrome + spacing.xl }}>
        <Card style={{ gap: spacing.md }}>
          <Field testID="lookup-query-input" label="Phone or reference" value={q} onChangeText={setQ} autoCapitalize="characters"
            placeholder="0803… or EG-7KQ2-9XHM" onSubmitEditing={search} returnKeyType="search" />
          <Button testID="lookup-search-button" title="Search" icon="search" onPress={search} loading={busy} />
          <T variant="caption">You can also paste the code text printed under a QR pass.</T>
        </Card>
        {matches !== null && (
          <FlatList scrollEnabled={false} data={matches} keyExtractor={(m) => m.ref_code} contentContainerStyle={{ gap: spacing.md }}
            ListEmptyComponent={<EmptyState testID="lookup-empty" icon="person-outline" title="No current pass found" message="Ask the visitor for their host's house number and send an approval request." />}
            renderItem={({ item }) => (
              <Card testID={`lookup-result-${item.ref_code}`} style={{ gap: spacing.sm }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: spacing.md }}>
                  <View style={{ flex: 1 }}>
                    <T variant="h3">{item.visitor_name}</T>
                    <T variant="caption">Host {item.host_name} · House {item.house_number}</T>
                    <T variant="caption">{PASS_TYPE_LABEL[item.pass_type]} · until {fmtDateTime(item.valid_to)}</T>
                  </View>
                  <StatusBadge status={item.status} />
                </View>
                <Button testID={`lookup-verify-${item.ref_code}`} title="Verify pass" onPress={() => verify(item.ref_code)} />
              </Card>
            )} />
        )}
        <Card style={{ gap: spacing.sm }}>
          <T variant="h3">Visitor without a pass?</T>
          <T variant="caption">Send a request to the household. Entry is only possible after a resident approves.</T>
          <Button testID="lookup-walk-in-button" title="Request resident approval" variant="secondary" icon="hand-left-outline" onPress={() => router.push("/guard/walk-in")} />
        </Card>
      </KeyboardAwareScrollView>
    </View>
  );
}
