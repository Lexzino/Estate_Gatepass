import { RoleTabs } from "@/src/components/RoleTabs";

export default function ResidentTabs() {
  return (
    <RoleTabs
      tabs={[
        { name: "index", title: "Home", icon: "home", sf: "house.fill" },
        { name: "passes", title: "Passes", icon: "qr-code", sf: "qrcode" },
        { name: "alerts", title: "Alerts", icon: "notifications", sf: "bell.fill" },
        { name: "account", title: "Account", icon: "person-circle", sf: "person.crop.circle.fill" },
      ]}
    />
  );
}
