import { useQuery } from "@tanstack/react-query";
import { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { usesNativeTabs } from "@/src/navigation";
import { spacing, useTheme } from "@/src/theme";
import { Button, Card, Header, Row, T } from "@/src/ui";

export function AccountScreen({ rows, children }: { rows: { label: string; value?: string | null }[]; children?: ReactNode }) {
  const { user, logout } = useAuth();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const notice = useQuery({ queryKey: ["privacy-notice"], queryFn: () => api<{ notice: string }>("/privacy-notice") });
  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}>
      <Header title="Account" subtitle={user?.full_name} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: bottomChrome + spacing.xl }}>
        <Card testID="account-profile-card">
          <Row label="Name" value={user?.full_name} testID="account-name" />
          <Row label="Role" value={user?.role ? user.role[0].toUpperCase() + user.role.slice(1) : ""} />
          {rows.map((r) => <Row key={r.label} label={r.label} value={r.value} />)}
        </Card>
        {children}
        <Card testID="account-privacy-card" style={{ gap: spacing.sm }}>
          <T variant="h3">Your privacy</T>
          <T variant="caption">{notice.data?.notice ?? "Loading privacy notice…"}</T>
        </Card>
        <Button testID="account-logout-button" title="Sign out" variant="secondary" icon="log-out-outline" onPress={logout} />
      </ScrollView>
    </View>
  );
}
