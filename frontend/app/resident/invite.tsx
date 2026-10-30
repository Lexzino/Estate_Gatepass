import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { fmtDateTime, PASS_TYPE_LABEL, VISIT_TYPE_LABEL } from "@/src/format";
import { passTokens } from "@/src/session-store";
import { fonts, makeStyles, radius, spacing, type, useTheme } from "@/src/theme";
import { Button, Card, Chip, ChipRow, Field, Header, T, useToast } from "@/src/ui";

const PASS_HELP: Record<string, string> = {
  one_time: "Single entry within a short window. Becomes invalid after use.",
  time_window: "Multiple entries across a few days (max 7).",
  recurring: "Regular visits on chosen days and hours, e.g. domestic staff.",
  contractor: "Workdays 08:00–18:00 for a project, up to 30 days.",
};
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = [6, 8, 10, 12, 14, 16, 18, 20];
const pad = (n: number) => String(n).padStart(2, "0");

export default function Invite() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [visitType, setVisitType] = useState("family_friend");
  const [passType, setPassType] = useState("one_time");
  const [dayOffset, setDayOffset] = useState(0);
  const [startHour, setStartHour] = useState<number | "now">("now");
  const [duration, setDuration] = useState(4);
  const [spanDays, setSpanDays] = useState(2);
  const [weeks, setWeeks] = useState(4);
  const [weekdays, setWeekdays] = useState<number[]>([0, 1, 2, 3, 4]);
  const [recStart, setRecStart] = useState(8);
  const [recEnd, setRecEnd] = useState(18);
  const [maxScans, setMaxScans] = useState(2);
  const [plate, setPlate] = useState("");
  const [purpose, setPurpose] = useState("");
  const [busy, setBusy] = useState(false);

  const window = useMemo(() => {
    const from = new Date();
    if (dayOffset > 0 || startHour !== "now") {
      from.setDate(from.getDate() + dayOffset);
      from.setHours(startHour === "now" ? 0 : startHour, 0, 0, 0);
    }
    const to = new Date(from);
    if (passType === "one_time") to.setTime(from.getTime() + duration * 3600e3);
    if (passType === "time_window") to.setTime(from.getTime() + spanDays * 86400e3);
    if (passType === "recurring") to.setTime(from.getTime() + weeks * 7 * 86400e3);
    if (passType === "contractor") to.setTime(from.getTime() + spanDays * 86400e3);
    return { from, to };
  }, [dayOffset, startHour, duration, spanDays, weeks, passType]);

  const pickPassType = (p: string) => {
    setPassType(p);
    if (p === "time_window") { setSpanDays(2); setMaxScans(4); }
    if (p === "recurring") setMaxScans(50);
    if (p === "contractor") { setSpanDays(14); setMaxScans(30); if (visitType === "family_friend") setVisitType("contractor"); }
  };

  const submit = async () => {
    if (passType === "recurring" && (!weekdays.length || recEnd <= recStart)) return toast("Pick days and an end hour after the start hour", "error");
    setBusy(true);
    try {
      const schedule = passType === "recurring" ? { days: [...weekdays].sort(), start: `${pad(recStart)}:00`, end: `${pad(recEnd)}:00` }
        : passType === "contractor" ? { days: [0, 1, 2, 3, 4, 5], start: "08:00", end: "18:00" } : undefined;
      const res = await api<{ visit: { id: string }; token: string }>("/residents/visits", {
        body: {
          visitor_name: name.trim(), visitor_phone: phone.trim(), visit_type: visitType, pass_type: passType,
          valid_from: window.from.toISOString(), valid_to: window.to.toISOString(),
          max_scans: passType === "one_time" ? 1 : maxScans, vehicle_plate: plate.trim() || undefined,
          purpose: purpose.trim() || undefined, schedule,
        },
      });
      passTokens.set(res.visit.id, res.token);
      qc.invalidateQueries({ queryKey: ["visits"] });
      router.replace(`/resident/pass/${res.visit.id}` as any);
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}>
      <Header title="Invite visitor" subtitle="Only the details security needs" onBack={() => router.back()} />
      <KeyboardAwareScrollView bottomOffset={24} contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} keyboardShouldPersistTaps="handled">
        <Card style={s.group}>
          <Field testID="invite-name-input" label="Visitor full name" value={name} onChangeText={setName} placeholder="John Doe" />
          <Field testID="invite-phone-input" label="Visitor phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="0803 000 0000" />
        </Card>

        <T variant="label">Visit type</T>
        <ChipRow style={s.bleed}>
          {Object.entries(VISIT_TYPE_LABEL).map(([k, l]) => (
            <Chip key={k} testID={`invite-visit-type-${k}`} label={l} selected={visitType === k} onPress={() => setVisitType(k)} />
          ))}
        </ChipRow>

        <T variant="label">Access type</T>
        <View style={s.typeGrid}>
          {Object.entries(PASS_TYPE_LABEL).map(([k, l]) => (
            <Pressable key={k} testID={`invite-pass-type-${k}`} onPress={() => pickPassType(k)} style={[s.typeCard, passType === k && s.typeCardOn]}>
              <Text style={[s.typeTitle, passType === k && s.typeTitleOn]}>{l}</Text>
              <Text style={[s.typeHelp, passType === k && s.typeTitleOn]} numberOfLines={3}>{PASS_HELP[k]}</Text>
            </Pressable>
          ))}
        </View>

        <T variant="label">Starts</T>
        <ChipRow style={s.bleed}>
          {Array.from({ length: 7 }).map((_, i) => {
            const d = new Date(); d.setDate(d.getDate() + i);
            const l = i === 0 ? "Today" : i === 1 ? "Tomorrow" : d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric" });
            return <Chip key={i} testID={`invite-day-${i}`} label={l} selected={dayOffset === i} onPress={() => { setDayOffset(i); if (i > 0 && startHour === "now") setStartHour(8); }} />;
          })}
        </ChipRow>
        <ChipRow style={s.bleed}>
          {dayOffset === 0 && <Chip testID="invite-start-now" label="Now" selected={startHour === "now"} onPress={() => setStartHour("now")} />}
          {HOURS.map((h) => <Chip key={h} testID={`invite-start-${h}`} label={`${pad(h)}:00`} selected={startHour === h} onPress={() => setStartHour(h)} />)}
        </ChipRow>

        {passType === "one_time" && (<>
          <T variant="label">Valid for</T>
          <ChipRow style={s.bleed}>
            {[1, 2, 4, 8, 12, 24].map((h) => <Chip key={h} testID={`invite-duration-${h}`} label={`${h} h`} selected={duration === h} onPress={() => setDuration(h)} />)}
          </ChipRow>
        </>)}
        {(passType === "time_window" || passType === "contractor") && (<>
          <T variant="label">Number of days</T>
          <ChipRow style={s.bleed}>
            {(passType === "time_window" ? [1, 2, 3, 5, 7] : [7, 14, 21, 30]).map((d) => (
              <Chip key={d} testID={`invite-days-${d}`} label={`${d} day${d > 1 ? "s" : ""}`} selected={spanDays === d} onPress={() => setSpanDays(d)} />
            ))}
          </ChipRow>
        </>)}
        {passType === "recurring" && (<>
          <T variant="label">Days of the week</T>
          <View style={s.weekRow}>
            {DAYS.map((d, i) => (
              <Pressable key={d} testID={`invite-weekday-${i}`} onPress={() => setWeekdays((w) => w.includes(i) ? w.filter((x) => x !== i) : [...w, i])}
                style={[s.weekday, weekdays.includes(i) && s.weekdayOn]}>
                <Text style={[s.weekdayText, weekdays.includes(i) && s.typeTitleOn]}>{d[0]}</Text>
              </Pressable>
            ))}
          </View>
          <T variant="label">Hours</T>
          <ChipRow style={s.bleed}>
            {[6, 7, 8, 9, 10].map((h) => <Chip key={h} testID={`invite-rec-start-${h}`} label={`From ${pad(h)}:00`} selected={recStart === h} onPress={() => setRecStart(h)} />)}
          </ChipRow>
          <ChipRow style={s.bleed}>
            {[12, 14, 16, 17, 18, 20].map((h) => <Chip key={h} testID={`invite-rec-end-${h}`} label={`Until ${pad(h)}:00`} selected={recEnd === h} onPress={() => setRecEnd(h)} />)}
          </ChipRow>
          <T variant="label">For</T>
          <ChipRow style={s.bleed}>
            {[1, 2, 4, 8, 12].map((w) => <Chip key={w} testID={`invite-weeks-${w}`} label={`${w} week${w > 1 ? "s" : ""}`} selected={weeks === w} onPress={() => setWeeks(w)} />)}
          </ChipRow>
        </>)}

        {passType !== "one_time" && (
          <Card style={s.stepper}>
            <View style={{ flex: 1 }}><T variant="h3">Allowed entries</T><T variant="caption">Pass stops working after this many entries</T></View>
            <Pressable testID="invite-entries-minus" style={s.stepBtn} onPress={() => setMaxScans((m) => Math.max(1, m - 1))}><Text style={s.stepTxt}>−</Text></Pressable>
            <Text style={s.stepVal} testID="invite-entries-value">{maxScans}</Text>
            <Pressable testID="invite-entries-plus" style={s.stepBtn} onPress={() => setMaxScans((m) => Math.min(50, m + 1))}><Text style={s.stepTxt}>+</Text></Pressable>
          </Card>
        )}

        <Card style={s.group}>
          <Field testID="invite-plate-input" label="Vehicle plate (optional)" value={plate} onChangeText={setPlate} autoCapitalize="characters" placeholder="LND-482KJ" />
          <Field testID="invite-purpose-input" label="Note for security (optional)" value={purpose} onChangeText={setPurpose} placeholder="Birthday visit" maxLength={120} />
        </Card>

        <Card testID="invite-summary" style={{ gap: 2 }}>
          <T variant="label">Pass window</T>
          <T variant="h3">{fmtDateTime(window.from.toISOString())} → {fmtDateTime(window.to.toISOString())}</T>
          {passType === "recurring" && <T variant="caption">{weekdays.sort().map((d) => DAYS[d]).join(", ")} · {pad(recStart)}:00–{pad(recEnd)}:00</T>}
          {passType === "contractor" && <T variant="caption">Mon–Sat · 08:00–18:00</T>}
        </Card>
        <Button testID="invite-submit-button" title="Create pass" icon="qr-code" onPress={submit} loading={busy} disabled={!name.trim() || !phone.trim()} />
      </KeyboardAwareScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  content: { padding: spacing.lg, gap: spacing.md },
  group: { gap: spacing.lg },
  bleed: { marginHorizontal: -spacing.lg },
  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  typeCard: { width: "48.5%", minHeight: 96, backgroundColor: c.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: c.border, gap: spacing.xs },
  typeCardOn: { backgroundColor: c.brandPrimary, borderColor: c.brandPrimary },
  typeTitle: { fontFamily: fonts.bold, fontSize: type.lg, color: c.onSurface },
  typeTitleOn: { color: c.onBrandPrimary },
  typeHelp: { fontFamily: fonts.regular, fontSize: type.sm, color: c.muted, lineHeight: 16 },
  weekRow: { flexDirection: "row", justifyContent: "space-between" },
  weekday: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, alignItems: "center", justifyContent: "center" },
  weekdayOn: { backgroundColor: c.brandPrimary, borderColor: c.brandPrimary },
  weekdayText: { fontFamily: fonts.bold, fontSize: type.base, color: c.onSurface },
  stepper: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  stepBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  stepTxt: { fontFamily: fonts.bold, fontSize: 22, color: c.onSurface },
  stepVal: { fontFamily: fonts.heavy, fontSize: type.xl, color: c.onSurface, minWidth: 28, textAlign: "center" },
}));
