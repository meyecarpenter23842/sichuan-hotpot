import React, { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { request, type AdminCatalog, type OpeningHour } from "./api";
import { Action, Notice, Pill } from "./ui";
import { c, font } from "./theme";
import { Icon } from "./Icon";

const weekdays = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư",
  "Thứ năm", "Thứ sáu", "Thứ bảy"];
const hhmm = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const pad = (value: number) => String(value).padStart(2, "0");
const hourChoices = Array.from({ length: 24 }, (_, i) => pad(i));
const minuteChoices = Array.from({ length: 60 }, (_, i) => pad(i));
type TimeField = "opensAt" | "closesAt";
type Picker = { weekday: number; field: TimeField; hour: string; minute: string };

function validDay(day: OpeningHour): string | null {
  // Closed days do not need a chronological opening interval.
  if (day.isClosed) return null;
  if (!hhmm.test(day.opensAt) || !hhmm.test(day.closesAt)) {
    return "Giờ mở và đóng phải có định dạng HH:mm.";
  }
  if (day.opensAt >= day.closesAt) {
    return "Giờ đóng phải sau giờ mở trong cùng ngày.";
  }
  return null;
}

function draft(hours: OpeningHour[]): OpeningHour[] {
  // No invented opening hours are persisted until the operator explicitly saves.
  return Array.from({ length: 7 }, (_, weekday) => hours.find(x => x.weekday === weekday)
    ?? { weekday, opensAt: "00:00", closesAt: "00:00", isClosed: true });
}

export function HoursPanel({ catalog, token, reload, onDirtyChange }: {
  catalog: AdminCatalog; token: string; reload: () => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [days, setDays] = useState(() => draft(catalog.openingHours));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [picker, setPicker] = useState<Picker | null>(null);
  const hourList = useRef<ScrollView>(null);
  const minuteList = useRef<ScrollView>(null);

  useEffect(() => { setDays(draft(catalog.openingHours)); }, [catalog.id, catalog.openingHours]);
  useEffect(() => { setError(""); setNotice(""); setPicker(null); }, [catalog.id]);
  useEffect(() => { onDirtyChange?.(JSON.stringify(days) !== JSON.stringify(draft(catalog.openingHours))); },
    [days, catalog.openingHours, onDirtyChange]);

  function edit(weekday: number, patch: Partial<OpeningHour>) {
    setDays(items => items.map(x => x.weekday === weekday ? { ...x, ...patch } : x));
    setError(""); setNotice("");
  }

  function toggleDay(day: OpeningHour) {
    if (!day.isClosed) {
      edit(day.weekday, { isClosed: true });
      return;
    }
    // First-open days previously kept 00:00–00:00 and blocked the whole week.
    // Seed only the local draft when an operator deliberately switches to "Mở cửa".
    const needsHours = !hhmm.test(day.opensAt) || !hhmm.test(day.closesAt)
      || day.opensAt >= day.closesAt;
    edit(day.weekday, needsHours
      ? { isClosed: false, opensAt: "08:00", closesAt: "21:00" }
      : { isClosed: false });
  }

  function openPicker(day: OpeningHour, field: TimeField) {
    if (saving) return;
    const time = day[field];
    const valid = hhmm.test(time) ? time : (field === "opensAt" ? "08:00" : "21:00");
    const hour = valid.slice(0, 2);
    const minute = valid.slice(3, 5);
    setPicker({ weekday: day.weekday, field, hour, minute });
  }

  function applyPicker() {
    if (!picker) return;
    edit(picker.weekday, { [picker.field]: picker.hour + ":" + picker.minute });
    setPicker(null);
  }

  async function save() {
    if (saving || picker) return;
    const invalid = days.find(x => validDay(x) !== null);
    if (invalid) {
      setNotice("");
      setError(weekdays[invalid.weekday] + ": " + validDay(invalid));
      return;
    }
    setSaving(true); setError(""); setNotice("");
    try {
      await request("/admin/branches/" + catalog.id + "/catalog/opening-hours",
        token, "PUT", { days });
      await reload();
      setNotice("Đã lưu lịch mở cửa cho chi nhánh.");
    } catch (e) { setError(e instanceof Error ? e.message : "Không lưu được lịch mở cửa."); }
    finally { setSaving(false); }
  }

  return <View style={st.root}>
    <Text style={st.title}>Giờ bán</Text>
    <Text style={st.note}>Lịch theo giờ Việt Nam (GMT+7). Chạm vào giờ để chọn giờ/phút. Chỉ lưu khi nhấn nút bên dưới.</Text>
    {catalog.openingHours.length === 0 &&
      <Notice text="Chi nhánh chưa cấu hình giờ bán. Không tự giả định giờ mở cửa." />}
    {days.map(day => {
      const issue = validDay(day);
      return <View key={day.weekday} style={st.row}>
        <View style={st.rowTop}>
          <Text style={st.weekday}>{weekdays[day.weekday]}</Text>
          <Pill label={day.isClosed ? "Nghỉ" : "Mở cửa"} active={!day.isClosed}
            onPress={() => toggleDay(day)} />
        </View>
        {!day.isClosed && <View style={st.times}>
          <View style={st.time}>
            <Text style={st.small}>Mở</Text>
            <Pressable accessibilityRole="button"
              accessibilityLabel={"Giờ mở " + weekdays[day.weekday]}
              disabled={saving} accessibilityState={{ disabled: saving }}
              style={({ pressed }) => [st.select, issue && st.selectInvalid,
                pressed && st.pressed]}
              onPress={() => openPicker(day, "opensAt")}>
              <Text style={st.selectText}>{day.opensAt}</Text>
              <View style={{ transform: [{ rotate: "90deg" }] }}><Icon name="chevron" size={16} color={c.red} /></View>
            </Pressable>
          </View>
          <Text style={st.dash}>–</Text>
          <View style={st.time}>
            <Text style={st.small}>Đóng</Text>
            <Pressable accessibilityRole="button"
              accessibilityLabel={"Giờ đóng " + weekdays[day.weekday]}
              disabled={saving} accessibilityState={{ disabled: saving }}
              style={({ pressed }) => [st.select, issue && st.selectInvalid,
                pressed && st.pressed]}
              onPress={() => openPicker(day, "closesAt")}>
              <Text style={st.selectText}>{day.closesAt}</Text>
              <View style={{ transform: [{ rotate: "90deg" }] }}><Icon name="chevron" size={16} color={c.red} /></View>
            </Pressable>
          </View>
        </View>}
        {!!issue && <Text accessibilityRole="alert" style={st.dayError}>
          {weekdays[day.weekday]}: {issue}
        </Text>}
        {picker?.weekday === day.weekday && <View style={st.sheet}>
          <View style={st.sheetHead}>
            <View style={st.sheetTitleGroup}>
              <Text style={st.sheetTitle}>Chọn {picker.field === "opensAt" ? "giờ mở" : "giờ đóng"}</Text>
              <Text style={st.sheetSubtitle}>{weekdays[picker.weekday]} · Giờ Việt Nam</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Đóng chọn giờ"
              style={st.close} onPress={() => setPicker(null)}>
              <Icon name="close" size={18} color={c.ink} />
            </Pressable>
          </View>
          <Text style={st.pickerPreview}>{picker.hour}:{picker.minute}</Text>
          <View style={st.pickerColumns}>
            <View style={st.pickerColumn}>
              <Text style={st.columnTitle}>Giờ (00–23)</Text>
              <ScrollView ref={hourList} nestedScrollEnabled style={st.choiceList}
                onLayout={() => hourList.current?.scrollTo({
                  y: Math.max(0, (Number(picker.hour) - 2) * 46), animated: false,
                })}>
                {hourChoices.map(hour =>
                  <Pressable key={hour} accessibilityRole="button"
                    accessibilityLabel={"Chọn giờ " + hour}
                    accessibilityState={{ selected: picker.hour === hour }}
                    onPress={() => setPicker(old => old ? { ...old, hour } : null)}
                    style={[st.choice, picker.hour === hour && st.choiceActive]}>
                    <Text style={[st.choiceText, picker.hour === hour && st.choiceTextActive]}>{hour}</Text>
                  </Pressable>)}
              </ScrollView>
            </View>
            <View style={st.pickerColumn}>
              <Text style={st.columnTitle}>Phút (00–59)</Text>
              <ScrollView ref={minuteList} nestedScrollEnabled style={st.choiceList}
                onLayout={() => minuteList.current?.scrollTo({
                  y: Math.max(0, (Number(picker.minute) - 2) * 46), animated: false,
                })}>
                {minuteChoices.map(minute =>
                  <Pressable key={minute} accessibilityRole="button"
                    accessibilityLabel={"Chọn phút " + minute}
                    accessibilityState={{ selected: picker.minute === minute }}
                    onPress={() => setPicker(old => old ? { ...old, minute } : null)}
                    style={[st.choice, picker.minute === minute && st.choiceActive]}>
                    <Text style={[st.choiceText, picker.minute === minute && st.choiceTextActive]}>{minute}</Text>
                  </Pressable>)}
              </ScrollView>
            </View>
          </View>
          <Text style={st.sheetHint}>Chọn giờ và phút từ danh sách. Có thể chọn chính xác từng phút.</Text>
          <Action label="Áp dụng giờ" onPress={applyPicker} />
          <Action label="Hủy" secondary onPress={() => setPicker(null)} />
    </View>}
      </View>;
    })}
    {!!error && <Notice text={error} error />}
    {!!notice && <Notice text={notice} />}
    <Action label={saving ? "Đang lưu..." : "Lưu lịch cửa hàng"} onPress={() => void save()} disabled={saving} />

  </View>;
}

const st = StyleSheet.create({
  root: { paddingBottom: 8, gap: 12 },
  title: { fontSize: font.title, fontWeight: "800", color: c.ink },
  note: { fontSize: font.note, lineHeight: 19, color: c.secondary },
  row: { borderBottomWidth: 1, borderBottomColor: c.line,
    paddingBottom: 10, paddingTop: 2, gap: 8 },
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  weekday: { fontSize: font.body, color: c.ink, fontWeight: "700" },
  times: { flexDirection: "row", gap: 10, alignItems: "center" },
  time: { flex: 1, minWidth: 0, gap: 4 },
  small: { color: c.secondary, fontSize: font.caption },
  dash: { color: c.secondary, marginTop: 17 },
  select: { minHeight: 46, borderWidth: 1, borderColor: "#D8DDE3", borderRadius: 9,
    backgroundColor: c.white, paddingHorizontal: 12, flexDirection: "row",
    alignItems: "center", justifyContent: "space-between" },
  selectInvalid: { borderColor: c.red },
  selectText: { fontSize: 15, color: c.ink, fontWeight: "600" },
  chevron: { fontSize: 20, color: c.red },
  pressed: { opacity: 0.75 },
  dayError: { fontSize: font.note, lineHeight: 18, color: c.red },
  sheet: { width: "100%", borderTopWidth: 1, borderTopColor: c.line,
    backgroundColor: c.pale, padding: 12, gap: 10 },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetTitleGroup: { flex: 1, gap: 4 },
  sheetTitle: { fontSize: font.title, color: c.ink, fontWeight: "800" },
  sheetSubtitle: { fontSize: font.note, color: c.secondary },
  close: { minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" },
  closeText: { fontSize: 19, color: c.ink },
  pickerPreview: { textAlign: "center", fontSize: 26, fontWeight: "800", color: c.red },
  pickerColumns: { flexDirection: "row", gap: 12, minHeight: 100 },
  pickerColumn: { flex: 1, minWidth: 0, gap: 5 },
  columnTitle: { fontSize: font.note, color: c.secondary, fontWeight: "700", textAlign: "center" },
  choiceList: { maxHeight: 200, borderWidth: 1, borderColor: c.line, borderRadius: 10 },
  choice: { minHeight: 44, marginBottom: 2, justifyContent: "center",
    alignItems: "center", borderRadius: 8, backgroundColor: c.white },
  choiceActive: { backgroundColor: c.soft },
  choiceText: { fontSize: 15, color: c.ink, fontWeight: "600" },
  choiceTextActive: { color: c.red, fontWeight: "800" },
  sheetHint: { fontSize: font.note, color: c.secondary, lineHeight: 18 },
});
