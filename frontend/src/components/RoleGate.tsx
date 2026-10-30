import { Redirect, Stack } from "expo-router";
import { ReactNode } from "react";

import { Role, useAuth } from "@/src/auth";

/** Each role has its own stack; anyone else is sent back to the router. */
export function RoleGate({ role, children }: { role: Role; children?: ReactNode }) {
  const { user, ready } = useAuth();
  if (!ready) return null;
  if (!user) return <Redirect href="/login" />;
  if (user.role !== role) return <Redirect href="/" />;
  return <>{children ?? <Stack screenOptions={{ headerShown: false }} />}</>;
}
