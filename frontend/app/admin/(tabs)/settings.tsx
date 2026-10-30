import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { api } from "@/src/api";
import { AccountScreen } from "@/src/components/AccountScreen";
import { fmtAgo } from "@/src/format";
import { spacing } from "@/src/theme";
import { Button, Card, Chip, ChipRow, StatusBadge, T, useToast } from "@/src/ui";

type Estate = { id: string; name: string; code: string; access_rules: { retention_days: number; offline_cache_hours: number; walk_in_pass_minutes: number; default_one_time_hours: number }; last_retention_run?: string };

export default function Settings() {
  const toast = useToast();
  const estates = useQuery({ queryKey: ["admin-estates"], queryFn: () => api<Estate[]>("/admin/estates") });
  const privacy = useQuery({ queryKey: ["admin-privacy"], queryFn: () => api<any[]>("/admin/privacy-requests") });
  const e = estates.data?.[0];
  const [rules, setRules] = useState<Estate["access_rules"] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { if (e) setRules(e.access_rules); }, [e]);

  const save = async () => {
    if (!e || !rules) return;
    setBusy("save");
    try { await api(`/admin/estates/${e.id}/rules`, { method: "PUT", body: rules }); toast("Settings saved", "success"); estates.refetch(); }
    catch (err: any) { toast(err.message, "error"); } finally { setBusy(null); }
  };
  const runRetention = async () => {
    setBusy("ret");
    try {
      const r = await api<any>("/admin/retention/run", { body: {} });
      toast(`Retention done · ${r.visits_deleted} visits, ${r.visitors_deleted} visitors removed`, "success");
      estates.refetch();
    } catch (err: any) { toast(err.message, "error"); } finally { setBusy(null); }
  };
  const setP = async (id: string, status: string) => {
    try { await api(`/admin/privacy-requests/${id}/status`, { body: { status } }); privacy.refetch(); } catch (err: any) { toast(err.message, "error"); }
  };
  const pick = (k: keyof Estate["access_rules"], v: number) => setRules((r) => (r ? { ...r, [k]: v } : r));

  return (
    <AccountScreen rows={[{ label: "Estate", value: e ? `${e.name} (${e.code})` : "" }]}>
      {rules ? (
        <Card testID="retention-settings-card" style={{ gap: spacing.sm }}>
          <T variant="h3">Data retention</T>
          <T variant="caption">Visitor records older than this are deleted automatically every day.</T>
          <ChipRow style={{ marginHorizontal: -spacing.lg }}>
            {[90, 180, 365].map((d) => <Chip key={d} testID={`retention-${d}`} label={d === 365 ? "12 months" : d === 180 ? "6 months" : "90 days"} selected={rules.retention_days === d} onPress={() => pick("retention_days", d)} />)}
          </ChipRow>
          <T variant="h3">Guard offline list</T>
          <ChipRow style={{ marginHorizontal: -spacing.lg }}>
            {[24, 48, 72].map((h) => <Chip key={h} testID={`offline-hours-${h}`} label={`${h} hours`} selected={rules.offline_cache_hours === h} onPress={() => pick("offline_cache_hours", h)} />)}
          </ChipRow>
          <T variant="h3">Walk-in pass after approval</T>
          <ChipRow style={{ marginHorizontal: -spacing.lg }}>
            {[15, 30, 60, 120].map((m) => <Chip key={m} testID={`walkin-minutes-${m}`} label={`${m} min`} selected={rules.walk_in_pass_minutes === m} onPress={() => pick("walk_in_pass_minutes", m)} />)}
          </ChipRow>
          <Button testID="settings-save-button" title="Save settings" onPress={save} loading={busy === "save"} />
          <Button testID="retention-run-button" title="Run retention now" variant="secondary" icon="trash-outline" onPress={runRetention} loading={busy === "ret"} />
          {e?.last_retention_run ? <T variant="caption">Last run {fmtAgo(e.last_retention_run)}</T> : null}
        </Card>
      ) : null}
      <Card testID="privacy-requests-card" style={{ gap: spacing.sm }}>
        <T variant="h3">Data subject requests</T>
        <T variant="caption">Access, correction and deletion requests from visitors and residents.</T>
        {(privacy.data ?? []).length === 0 ? <T variant="caption">No requests.</T> : (privacy.data ?? []).map((p) => (
          <View key={p.id} style={{ gap: spacing.xs, paddingVertical: spacing.sm }} testID={`privacy-request-${p.id}`}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <T variant="h3">{p.type} · {p.contact}</T>
              <StatusBadge status={p.status} />
            </View>
            {p.details ? <T variant="caption">{p.details}</T> : null}
            {p.status !== "completed" && <Button testID={`privacy-complete-${p.id}`} title="Mark completed" variant="secondary" onPress={() => setP(p.id, "completed")} />}
          </View>
        ))}
      </Card>
    </AccountScreen>
  );
}
