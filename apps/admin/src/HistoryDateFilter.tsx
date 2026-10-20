import React, { useState } from "react";
import {
  Modal, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { c } from "./theme";
import {
  calendarGrid, historyPeriodRange, rangeDays, showDay, vietnamDay,
  type HistoryRange, type HistoryPeriod,
} from "./history-search";

const presets: { key: Exclude<HistoryPeriod, "custom">; name: string }[] = [
  { key: "all", name: "Mọi ngày" },
  { key: "today", name: "Hôm nay" },
  { key: "week", name: "7 ngày" },
  { key: "month", name: "30 ngày" },
];
const weekdays = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

export function HistoryDateFilter({ value, onChange }: {
  value: HistoryRange; onChange: (next: HistoryRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => vietnamDay().slice(0, 7));
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const [error, setError] = useState("");
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7)) - 1;

  const openPicker = () => {
    const selected = value.from ?? vietnamDay();
    setMonth(selected.slice(0, 7));
    setStart(value.period === "custom" ? value.from : null);
    setEnd(value.period === "custom" ? value.to : null);
    setError("");
    setOpen(true);
  };
  const changeMonth = (shift: number) => {
    const d = new Date(Date.UTC(year, monthIndex + shift, 1));
    if (d.getUTCFullYear() < 2000 || d.getUTCFullYear() > 2100) return;
    setMonth(d.toISOString().slice(0, 7));
  };
  const selectDay = (day: string) => {
    setError("");
    if (!start || end || day < start) {
      setStart(day); setEnd(null);
    } else {
      setEnd(day);
    }
  };
  const apply = () => {
    if (!start) { setError("Vui lòng chọn ngày bắt đầu."); return; }
    const to = end ?? start;
    if (rangeDays(start, to) > 366) {
      setError("Khoảng ngày tối đa 366 ngày."); return;
    }
    onChange({ period: "custom", from: start, to });
    setOpen(false);
  };

  return <View style={styles.wrapper}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="always" contentContainerStyle={styles.chips}
      accessibilityLabel="Lọc theo ngày tạo đơn">
      {presets.map(item => <Pressable key={item.key} accessibilityRole="button"
        accessibilityLabel={"Ngày tạo: " + item.name}
        accessibilityState={{ selected: value.period === item.key }}
        onPress={() => onChange(historyPeriodRange(item.key))}
        style={[styles.chip, value.period === item.key && styles.selected]}>
        <Text style={[styles.chipText, value.period === item.key && styles.selectedText]}>
          {item.name}
        </Text>
      </Pressable>)}
      <Pressable accessibilityRole="button" accessibilityLabel="Chọn khoảng ngày tùy chọn"
        accessibilityState={{ selected: value.period === "custom" }}
        onPress={openPicker} style={[styles.chip, value.period === "custom" && styles.selected]}>
        <Text style={[styles.chipText, value.period === "custom" && styles.selectedText]}>
          {value.period === "custom" && value.from && value.to
            ? showDay(value.from).slice(0, 5) + " – " + showDay(value.to).slice(0, 5)
            : "Tùy chọn"}
        </Text>
      </Pressable>
    </ScrollView>
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <SafeAreaView edges={["top", "bottom"]} style={styles.overlay}>
        <Pressable accessibilityRole="button" accessibilityLabel="Đóng chọn khoảng ngày"
          style={StyleSheet.absoluteFillObject} onPress={() => setOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.title}>Ngày tạo đơn</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Đóng lịch"
              style={styles.closeButton} onPress={() => setOpen(false)}>
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>
          <Text style={styles.caption}>Chọn ngày bắt đầu, rồi chọn ngày kết thúc.</Text>
          <View style={styles.selection}>
            <Text style={styles.selectionText}>Từ: {start ? showDay(start) : "—"}</Text>
            <Text style={styles.selectionText}>Đến: {end ? showDay(end) : start ? "Cùng ngày" : "—"}</Text>
          </View>
          <View style={styles.monthRow}>
            <Pressable accessibilityRole="button" accessibilityLabel="Tháng trước"
              style={styles.nav} onPress={() => changeMonth(-1)}>
              <Text style={styles.navText}>‹</Text>
            </Pressable>
            <Text style={styles.monthTitle}>Tháng {monthIndex + 1}/{year}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Tháng sau"
              style={styles.nav} onPress={() => changeMonth(1)}>
              <Text style={styles.navText}>›</Text>
            </Pressable>
          </View>
          <View style={styles.calendar}>
            {weekdays.map(w => <View key={w} style={styles.dayCell}>
              <Text style={styles.weekday}>{w}</Text>
            </View>)}
            {calendarGrid(year, monthIndex).map((day, i) => <View key={i} style={styles.dayCell}>
              {day && <Pressable accessibilityRole="button"
                accessibilityLabel={"Chọn ngày " + showDay(day)}
                accessibilityState={{ selected: day === start || day === end }}
                onPress={() => selectDay(day)}
                style={[styles.dayButton,
                  start && day >= start && end && day <= end && styles.inRange,
                  (day === start || day === end) && styles.daySelected]}>
                <Text style={[styles.dayText,
                  (day === start || day === end) && styles.daySelectedText]}>
                  {Number(day.slice(8))}
                </Text>
              </Pressable>}
            </View>)}
          </View>
          {!!error && <Text style={styles.error}>{error}</Text>}
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" accessibilityLabel="Bỏ lọc ngày"
              style={styles.clear} onPress={() => {
                onChange(historyPeriodRange("all")); setOpen(false);
              }}>
              <Text style={styles.clearText}>Xóa lọc</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Áp dụng khoảng ngày"
              style={styles.apply} onPress={apply}>
              <Text style={styles.applyText}>Áp dụng</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  wrapper: { flexGrow: 0 },
  chips: { gap: 6, alignItems: "center", paddingVertical: 2, paddingHorizontal: 2 },
  chip: { minHeight: 42, borderRadius: 9, paddingHorizontal: 12,
    backgroundColor: "#F6F1EC", justifyContent: "center" },
  selected: { backgroundColor: "#FDE4E8" },
  chipText: { color: c.secondary, fontSize: 12, fontWeight: "700" },
  selectedText: { color: c.redDeep },
  overlay: { flex: 1, backgroundColor: "#0008", justifyContent: "center",
    paddingHorizontal: 12 },
  sheet: { borderRadius: 18, backgroundColor: c.white, padding: 14, gap: 8,
    maxWidth: 460, width: "100%", alignSelf: "center" },
  sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 17, fontWeight: "800", color: c.ink },
  caption: { fontSize: 12, color: c.secondary },
  closeButton: { minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" },
  closeText: { fontSize: 20, color: c.ink },
  selection: { flexDirection: "row", justifyContent: "space-between", gap: 6,
    paddingVertical: 8, paddingHorizontal: 8, backgroundColor: "#F6F1EC", borderRadius: 9 },
  selectionText: { fontSize: 12, color: c.ink, fontWeight: "700", flexShrink: 1 },
  monthRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  monthTitle: { fontSize: 15, color: c.ink, fontWeight: "800" },
  nav: { minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" },
  navText: { fontSize: 28, color: c.redDeep },
  calendar: { flexDirection: "row", flexWrap: "wrap" },
  dayCell: { width: "14.2857%", minHeight: 42, justifyContent: "center", alignItems: "center" },
  weekday: { fontSize: 11, fontWeight: "700", color: c.secondary },
  dayButton: { width: "100%", height: 42, alignItems: "center", justifyContent: "center",
    borderRadius: 9 },
  inRange: { backgroundColor: "#FCE5E7" },
  daySelected: { backgroundColor: c.redDeep },
  dayText: { color: c.ink, fontWeight: "700", fontSize: 13 },
  daySelectedText: { color: c.white },
  error: { fontSize: 12, color: c.redDeep, fontWeight: "700" },
  actions: { flexDirection: "row", gap: 10, marginTop: 5 },
  clear: { flex: 1, minHeight: 46, borderRadius: 9, borderWidth: 1,
    borderColor: c.line, justifyContent: "center", alignItems: "center" },
  clearText: { color: c.secondary, fontWeight: "800" },
  apply: { flex: 1, minHeight: 46, borderRadius: 9,
    justifyContent: "center", alignItems: "center", backgroundColor: c.redDeep },
  applyText: { color: c.white, fontWeight: "800" },
});
