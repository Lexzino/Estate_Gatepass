import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";

import { useAuth } from "@/src/auth";
import { useTheme } from "@/src/theme";

export default function Index() {
  const { user, ready } = useAuth();
  const { colors } = useTheme();
  if (!ready)
    return (
      <View testID="boot-loading" style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface }}>
        <ActivityIndicator color={colors.brandPrimary} />
      </View>
    );
  if (!user) return <Redirect href="/login" />;
  return <Redirect href={`/${user.role}` as any} />;
}
