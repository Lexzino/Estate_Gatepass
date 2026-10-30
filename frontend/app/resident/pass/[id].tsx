import Ionicons from "@react-native-vector-icons/ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, ScrollView, Share, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, BASE_URL } from "@/src/api";
import type { Visit } from "@/src/components/PassCard";
import { fmtDateTime, PASS_TYPE_LABEL, STATUS_LABEL, VISIT_TYPE_LABEL } from "@/src/format";
import { passTokens } from "@/src/session-store";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { Button, Card, ErrorCard, Header, Row, Sheet, StatusBadge, T, useToast } from "@/src/ui";

type Detail = Visit & { events: { id: string; scanned_at: string; result: string; decision?: string; gate: string; exit_at?: string; offline: boolean }[] };
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function PassDetail() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [token, setToken] = useState<string | undefined>(passTokens.get(id));
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["visit", id], queryFn: () => api<Detail>(`/residents/visits/${id}`) });
  const v = q.data;
  const live = v && (v.status === "active" || v.status === "pending");

  const share = async () => {
    if (!token || !v) return;
    const link = `${BASE_URL}/api/p/${token}`;
    await Share.share({
      message: `Hi ${v.visitor_name.split(" ")[0]}, here is your EstateGate pass. Show the QR code at the gate.\nValid ${fmtDateTime(v.valid_from)} – ${fmtDateTime(v.valid_to)}\nRef: ${v.ref_code}\n${link}`,
    }).catch(() => null);
  };
  const revoke = async () => {
    setBusy("revoke");
    try {
      await api(`/residents/visits/${id}/revoke`, { body: {} });
      passTokens.delete(id);
      setToken(undefined);
      setConfirmRevoke(false);
      toast("Pass revoked. It will be refused at the gate.", "success");
      qc.invalidateQueries({ queryKey: ["visits"] });
      q.refetch();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(null);
    }
  };
  const reissue = async () => {
    setBusy("reissue");
    try {
      const r = await api<{ token: string }>(`/residents/visits/${id}/reissue`, { body: {} });
      passTokens.set(id, r.token);
      setToken(r.token);
      toast("New QR created. The previous code no longer works.", "success");
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}>
      <Header title="Visitor pass" subtitle={v?.ref_code} onBack={() => (router.canGoBack() ? router.back() : router.replace("/resident"))} />
      {q.isLoading ? <ActivityIndicator style={{ marginTop: spacing["2xl"] }} color={colors.brandPrimary} /> : q.error || !v ? (
        <View style={{ padding: spacing.lg }}><ErrorCard message="Unable to load this pass" onRetry={() => q.refetch()} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}>
          <Card style={s.qrCard} testID="pass-qr-card">
            <View style={s.qrTop}>
              <View style={{ flex: 1 }}>
                <T variant="h2" testID="pass-visitor-name">{v.visitor_name}</T>
                <T variant="caption">{VISIT_TYPE_LABEL[v.visit_type]} · {PASS_TYPE_LABEL[v.pass_type]}</T>
              </View>
              <StatusBadge status={v.status} testID="pass-detail-status" />
            </View>
            {token && live ? (
              <View style={s.qrBox} testID="pass-qr-code">
                <QRCode value={token} size={232} ecl="M" color={colors.onSurface} backgroundColor={colors.surface} />
              </View>
            ) : (
              <View style={[s.qrBox, s.qrHidden]} testID="pass-qr-hidden">
                <Ionicons name={live ? "eye-off-outline" : "close-circle-outline"} size={36} color={colors.muted} />
                <T variant="caption" style={{ textAlign: "center" }}>
                  {live ? "For security, QR codes are only shown right after creation. Reissue to get a fresh code — the old one stops working."
                    : `This pass is ${STATUS_LABEL[v.status]?.toLowerCase()} and can no longer be used.`}
                </T>
              </View>
            )}
            <T variant="caption" style={{ textAlign: "center" }}>Reference {v.ref_code} · guards can look this up</T>
          </Card>

          {live && (
            <View style={{ gap: spacing.md }}>
              {token ? (
                <Button testID="pass-share-button" title="Share pass" icon="share-outline" onPress={share} />
              ) : (
                <Button testID="pass-reissue-button" title="Reissue QR code" icon="refresh" onPress={reissue} loading={busy === "reissue"} />
              )}
              <Button testID="pass-revoke-button" title="Revoke pass" icon="ban" variant="destructive" onPress={() => setConfirmRevoke(true)} />
            </View>
          )}

          <Card>
            <Row label="Valid from" value={fmtDateTime(v.valid_from)} testID="pass-valid-from" />
            <Row label="Valid until" value={fmtDateTime(v.valid_to)} testID="pass-valid-to" />
            {v.schedule ? <Row label="Schedule" value={`${v.schedule.days.map((d: number) => DAYS[d]).join(" ")} · ${v.schedule.start}–${v.schedule.end}`} /> : null}
            <Row label="Entries" value={`${v.scan_count} of ${v.max_scans} used`} testID="pass-entries" />
            <Row label="Visitor phone" value={v.visitor_phone_masked} />
            {v.vehicle_plate ? <Row label="Vehicle" value={v.vehicle_plate} /> : null}
            {v.purpose ? <Row label="Note" value={v.purpose} /> : null}
          </Card>

          <T variant="label">Gate activity</T>
          {v.events.length === 0 ? <T variant="caption">No scans yet.</T> : v.events.map((e) => (
            <Card key={e.id} style={s.event} testID={`pass-event-${e.id}`}>
              <Ionicons name={e.decision === "admitted" ? "log-in" : "scan"} size={20} color={colors.onSurface} />
              <View style={{ flex: 1 }}>
                <T variant="h3">{e.decision === "admitted" ? "Entered" : STATUS_LABEL[e.result] ?? e.result} · {e.gate}</T>
                <T variant="caption">{fmtDateTime(e.scanned_at)}{e.exit_at ? ` · left ${fmtDateTime(e.exit_at)}` : ""}{e.offline ? " · offline scan" : ""}</T>
              </View>
            </Card>
          ))}
        </ScrollView>
      )}
      <Sheet visible={confirmRevoke} onClose={() => setConfirmRevoke(false)} testID="revoke-sheet" title="Revoke this pass?"
        message="The visitor will be refused at every gate immediately. This can't be undone.">
        <Button testID="revoke-confirm-button" title="Revoke pass" variant="destructive" onPress={revoke} loading={busy === "revoke"} />
        <Button testID="revoke-cancel-button" title="Keep pass" variant="secondary" onPress={() => setConfirmRevoke(false)} />
      </Sheet>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  qrCard: { gap: spacing.lg, shadowOpacity: 0.1, shadowRadius: 16, elevation: 4 },
  qrTop: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  qrBox: { alignSelf: "center", padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  qrHidden: { width: 264, height: 264, alignItems: "center", justifyContent: "center", gap: spacing.md, backgroundColor: c.surfaceSecondary },
  event: { flexDirection: "row", alignItems: "center", gap: spacing.md },
}));
