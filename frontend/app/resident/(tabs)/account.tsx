import { useQuery } from "@tanstack/react-query";

import { api } from "@/src/api";
import { AccountScreen } from "@/src/components/AccountScreen";

export default function ResidentAccount() {
  const me = useQuery({ queryKey: ["resident-me"], queryFn: () => api("/residents/me") });
  return (
    <AccountScreen
      rows={[
        { label: "Estate", value: me.data?.estate?.name },
        { label: "House", value: me.data?.house_number },
        { label: "Phone", value: me.data?.phone_masked },
        { label: "Email", value: me.data?.email },
      ]}
    />
  );
}
