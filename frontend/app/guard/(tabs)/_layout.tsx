import { RoleTabs } from "@/src/components/RoleTabs";

export default function GuardTabs() {
  return (
    <RoleTabs
      tabs={[
        { name: "index", title: "Scan", icon: "scan", sf: "qrcode.viewfinder" },
        { name: "lookup", title: "Lookup", icon: "search", sf: "magnifyingglass" },
        { name: "log", title: "Log", icon: "list", sf: "list.bullet" },
        { name: "account", title: "Account", icon: "person-circle", sf: "person.crop.circle.fill" },
      ]}
    />
  );
}
