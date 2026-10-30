import { AccountScreen } from "@/src/components/AccountScreen";
import { fmtDateTime } from "@/src/format";
import { useGuard } from "@/src/guard";
import { Button, Card, T, useToast } from "@/src/ui";
import { spacing } from "@/src/theme";

export default function GuardAccount() {
  const { me, cacheInfo, pending, syncNow, syncing } = useGuard();
  const toast = useToast();
  return (
    <AccountScreen rows={[{ label: "Estate", value: me?.estate.name }, { label: "Device", value: "Bound to this phone" }]}>
      <Card testID="offline-cache-card" style={{ gap: spacing.sm }}>
        <T variant="h3">Offline mode</T>
        <T variant="caption" testID="offline-cache-info">
          {cacheInfo ? `${cacheInfo.count} passes cached (encrypted) · updated ${fmtDateTime(cacheInfo.generated_at)}` : "No offline list yet"}
          {` · ${pending} scans pending sync`}
        </T>
        <T variant="caption">The cache holds only visitor and host display names, house numbers and pass windows for the next 24–72 hours.</T>
        <Button testID="account-sync-button" title="Sync now" variant="secondary" icon="sync" loading={syncing}
          onPress={async () => toast((await syncNow()) ? "Offline list updated" : "Still offline", "info")} />
      </Card>
    </AccountScreen>
  );
}
