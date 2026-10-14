import React, { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { request, type AdminCatalog, type OpeningHour } from "./api";
import { Action, Notice, Pill } from "./ui";
import { c, font } from "./theme";

const weekdays = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư",
  "Thứ năm", "Thứ sáu", "Thứ bảy"];
const hhmm = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
function draft(hours: OpeningHour[]): OpeningHour[] {
  return Array.from({ length: 7 }, (_, weekday) => hours.find(x => x.weekday === weekday)
    ?? { weekday, opensAt: "00:00", closesAt: "00:00", isClosed: true });
}
export function HoursPanel({ catalog, token, reload }: {
  catalog: AdminCatalog; token: string; reload: () => Promise<void>;
}) {
  const [days, setDays] = useState(() => draft(catalog.openingHours));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    setDays(draft(catalog.openingHours));
    setError(""); setNotice("");
  }, [catalog.id, catalog.openingHours]);

  function edit(weekday: number, patch: Partial<OpeningHour>) {
    setDays(items => items.map(x => x.weekday === weekday ? { ...x, ...patch } : x));
  }
  async function save() {
    if (saving) return;
    if (days.some(x => !hhmm.test(x.opensAt) || !hhmm.test(x.closesAt)
      || (!x.isClosed && x.opensAt >= x.closesAt))) {
      setError("Giờ phải ở dạng HH:mm; giờ đóng phải sau giờ mở.");
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
    <Text style={st.note}>Lịch theo giờ Việt Nam (GMT+7). Thay đổi chỉ có hiệu lực sau khi nhấn Lưu.</Text>
    {catalog.openingHours.length === 0 && <Notice text="Chi nhánh chưa cấu hình giờ bán. Không tự giả định giờ mở cửa." />}
    {days.map(day => (
      <View key={day.weekday} style={st.row}>
        <View style={st.rowTop}>
          <Text style={st.weekday}>{weekdays[day.weekday]}</Text>
          <Pill label={day.isClosed ? "Nghỉ" : "Mở cửa"} active={!day.isClosed}
            onPress={() => edit(day.weekday, { isClosed: !day.isClosed })} />
        </View>
        {!day.isClosed && <View style={st.times}>
          <View style={st.time}>
            <Text style={st.small}>Mở</Text>
            <TextInput value={day.opensAt} onChangeText={text => edit(day.weekday, { opensAt: text })}
              accessibilityLabel={"Giờ mở " + weekdays[day.weekday]}
              maxLength={5} keyboardType="numbers-and-punctuation" style={st.input}
              placeholder="08:00" />
          </View>
          <Text style={st.dash}>–</Text>
          <View style={st.time}>
            <Text style={st.small}>Đóng</Text>
            <TextInput value={day.closesAt} onChangeText={text => edit(day.weekday, { closesAt: text })}
              accessibilityLabel={"Giờ đóng " + weekdays[day.weekday]}
              maxLength={5} keyboardType="numbers-and-punctuation" style={st.input}
              placeholder="22:00" />
          </View>
        </View>}
      </View>
    ))}
    {!!error && <Notice text={error} error />}
    {!!notice && <Notice text={notice} />}
    <Action label={saving ? "Đang lưu..." : "Lưu lịch cửa hàng"} onPress={() => void save()} disabled={saving} />
  </View>;
}
const st = StyleSheet.create({
  root: { paddingHorizontal: 15, paddingVertical: 16, paddingBottom: 36, gap: 12 },
  title: { fontSize: font.title, fontWeight: "800", color: c.ink },
  note: { fontSize: font.note, lineHeight: 19, color: c.secondary },
  row: { borderBottomWidth: 1, borderBottomColor: c.line,
    paddingBottom: 10, paddingTop: 2, gap: 8 },
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  weekday: { fontSize: font.body, color: c.ink, fontWeight: "700" },
  times: { flexDirection: "row", gap: 10, alignItems: "center" },
  time: { flex: 1, gap: 4 }, small: { color: c.secondary, fontSize: font.caption },
  dash: { color: c.secondary },
  input: { minHeight: 44, borderWidth: 1, borderColor: "#D8DDE3", borderRadius: 9,
    backgroundColor: c.white, paddingHorizontal: 11, fontSize: 16, color: c.ink },
});
