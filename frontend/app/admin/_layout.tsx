import { RoleGate } from "@/src/components/RoleGate";

export default function AdminLayout() {
  return <RoleGate role="admin" />;
}
