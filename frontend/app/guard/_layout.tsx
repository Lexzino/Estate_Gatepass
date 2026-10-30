import { Stack } from "expo-router";

import { RoleGate } from "@/src/components/RoleGate";
import { GuardProvider } from "@/src/guard";

export default function GuardLayout() {
  return (
    <RoleGate role="guard">
      <GuardProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="result" options={{ presentation: "fullScreenModal", animation: "fade", gestureEnabled: false }} />
        </Stack>
      </GuardProvider>
    </RoleGate>
  );
}
