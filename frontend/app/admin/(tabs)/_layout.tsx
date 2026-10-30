import { RoleTabs } from "@/src/components/RoleTabs";

export default function AdminTabs() {
  return (
    <RoleTabs
      tabs={[
        { name: "index", title: "Overview", icon: "grid", sf: "square.grid.2x2.fill" },
        { name: "people", title: "People", icon: "people", sf: "person.2.fill" },
        { name: "security", title: "Security", icon: "shield", sf: "shield.fill" },
        { name: "settings", title: "Settings", icon: "settings", sf: "gearshape.fill" },
      ]}
    />
  );
}
