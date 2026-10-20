import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { request } from "./api";
import { Icon } from "./Icon";
import { HistoryDateFilter } from "./HistoryDateFilter";
import {
  historyPeriodRange, showDay, type HistoryRange,
} from "./history-search";
import { c, font } from "./theme";

export type ReportMetric = "CREATED" | "COHORT_CANCELED" | "DELIVERED" |
  "CANCELED" | "FAILED" | "CONFIRMED" | "COD_CONFIRMED" |
  "QR_CONFIRMED" | "PENDING" | "REFUNDED";
type DailyReport = {
  day: string;
  createdCount: number; cohortCanceledCount: number;
  deliveredCount: number; canceledCount: number; failedCount: number;
  deliveredValueVnd: number; confirmedPaymentVnd: number;
  codConfirmedVnd: number; qrConfirmedVnd: number;
  pendingPaymentVnd: number; refundedPaymentVnd: number;
};
type BusinessReport = {
  from: string; to: string; timezone: "Asia/Ho_Chi_Minh";
  days: DailyReport[]; totals: Omit<DailyReport, "day">;
  cancellationRatePercent: number;
  cancellationRateBasis: "CREATED_COHORT_CURRENT_STATUS";
  paymentBasis: "CURRENT_CONFIRMED_STATUS_BY_DELIVERY_DATE";
  paymentCollectedAtAvailable: false;
};
const money = (amount: number): string => amount.toLocaleString("vi-VN") + "đ";
const fmtDay = (day: string): string => showDay(day).slice(0, 5);

export function BusinessReportPanel({ token, branchId, range, onRangeChange, onClose,
  onDrillDown }: {
  token: string; branchId: string;
  range: HistoryRange; onRangeChange: (next: HistoryRange) => void;
  onClose: () => void;
  onDrillDown: (metric: ReportMetric, range: HistoryRange) => void;
}) {
  const [report, setReport] = useState<BusinessReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const sequence = useRef(0);
  const from = range.from ?? historyPeriodRange("week").from!;
  const to = range.to ?? historyPeriodRange("week").to!;
  const refresh = useCallback(() => setRevision(x => x + 1), []);
  useEffect(() => {
    let live = true;
    const current = ++sequence.current;
    setBusy(true); setError("");
    setReport(null);
    void request<BusinessReport>("/admin/orders/" + branchId +
      "/business-report?from=" + encodeURIComponent(from) +
      "&to=" + encodeURIComponent(to), token)
      .then(result => {
        if (!live || current !== sequence.current) return;
        setReport(result);
      })
      .catch(err => {
        if (!live || current !== sequence.current) return;
        setError(err instanceof Error ? err.message : "Không thể tải báo cáo kinh doanh.");
      })
      .finally(() => {
        if (live && current === sequence.current) setBusy(false);
      });
    return () => { live = false; sequence.current++; };
  }, [branchId, token, from, to, revision]);

  const totals = report?.totals;
  const period: HistoryRange = { period: "custom", from, to };
  const groups: { title: string; metrics: {
    label: string; value: string; metric: ReportMetric; note?: string;
  }[] }[] = [
    { title: "Đơn hàng", metrics: [
      { label: "Đơn tạo trong kỳ", value: String(totals?.createdCount ?? 0), metric: "CREATED" },
      { label: "Đã giao trong kỳ", value: String(totals?.deliveredCount ?? 0), metric: "DELIVERED" },
      { label: "Đã hủy trong kỳ", value: String(totals?.canceledCount ?? 0), metric: "CANCELED" },
      { label: "Giao thất bại", value: String(totals?.failedCount ?? 0), metric: "FAILED" },
      { label: "Tỷ lệ hủy", value: String(report?.cancellationRatePercent ?? 0) + "%",
        metric: "COHORT_CANCELED",
        note: "Đơn tạo trong kỳ hiện đã hủy / tổng đơn tạo trong kỳ" },
    ] },
    { title: "Giá trị & thanh toán", metrics: [
      { label: "Giá trị đơn giao", value: money(totals?.deliveredValueVnd ?? 0),
        metric: "DELIVERED" },
      { label: "Đã xác nhận thu*", value: money(totals?.confirmedPaymentVnd ?? 0),
        metric: "CONFIRMED" },
      { label: "COD xác nhận", value: money(totals?.codConfirmedVnd ?? 0),
        metric: "COD_CONFIRMED" },
      { label: "QR xác nhận", value: money(totals?.qrConfirmedVnd ?? 0),
        metric: "QR_CONFIRMED" },
      { label: "Chưa xác nhận", value: money(totals?.pendingPaymentVnd ?? 0),
        metric: "PENDING" },
      { label: "Khoản đã hoàn tiền", value: money(totals?.refundedPaymentVnd ?? 0),
        metric: "REFUNDED" },
    ] },
  ];
  const maxValue = Math.max(1, ...(report?.days.map(row => row.deliveredValueVnd) ?? []));

  return <View style={s.page}>
    <View style={s.head}>
      <Pressable accessibilityRole="button" accessibilityLabel="Quay lại Tổng quan"
        onPress={onClose} style={s.back}>
        <Icon name="chevron" size={19} color={c.redDeep} />
        <Text style={s.backText}>Tổng quan</Text>
      </Pressable>
      <Text style={s.title}>Báo cáo kinh doanh</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Làm mới báo cáo"
        onPress={refresh} style={s.refresh}>
        <Icon name="clock" size={19} color={c.redDeep} />
      </Pressable>
    </View>
    <HistoryDateFilter report value={range} onChange={onRangeChange} />
    <Text style={s.caption}>Kỳ {showDay(from)} – {showDay(to)} · Giờ Việt Nam</Text>
    {busy && <View style={s.center}>
      <ActivityIndicator color={c.red} />
      <Text style={s.caption}>Đang tổng hợp số liệu...</Text>
    </View>}
    {!!error && <View style={s.error}>
      <Text style={s.errorText}>{error}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Thử tải lại báo cáo"
        onPress={refresh} style={s.retry}>
        <Text style={s.retryText}>Thử lại</Text>
      </Pressable>
    </View>}
    {report && <View style={s.content}>
      {groups.map(group => <View key={group.title}>
        <Text style={s.section}>{group.title}</Text>
        {group.metrics.map(item => <Pressable key={item.label}
          accessibilityRole="button"
          accessibilityLabel={"Xem đơn: " + item.label}
          onPress={() => onDrillDown(item.metric, period)}
          style={s.metric}>
          <View style={s.metricCopy}>
            <Text style={s.metricLabel}>{item.label}</Text>
            {!!item.note && <Text style={s.metricNote}>{item.note}</Text>}
          </View>
          <Text style={s.metricValue} numberOfLines={1}>{item.value}</Text>
          <Text style={s.chevron}>›</Text>
        </Pressable>)}
      </View>)}
      <Text style={s.disclaimer}>
        * Số tiền đang ở trạng thái đã xác nhận của các đơn giao trong kỳ;
        nhóm theo ngày giao, KHÔNG phải dòng tiền theo ngày thực nhận.
        Thanh toán chờ xác nhận hoặc đã hoàn tiền không tính vào khoản này.
      </Text>
      <Text style={s.section}>Giá trị giao theo ngày</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        accessibilityLabel="Biểu đồ giá trị đơn giao theo ngày"
        contentContainerStyle={s.chart}>
        {report.days.map(day => <Pressable key={day.day}
          accessibilityRole="button" accessibilityLabel={
            "Ngày " + showDay(day.day) + ", giá trị " + money(day.deliveredValueVnd)}
          onPress={() => onDrillDown("DELIVERED",
            { period: "custom", from: day.day, to: day.day })}
          style={s.chartColumn}>
          <Text style={s.chartValue} numberOfLines={1}>
            {day.deliveredValueVnd ? Math.round(day.deliveredValueVnd / 1000) + "k" : "0"}
          </Text>
          <View style={s.barTrack}>
            <View style={[s.bar, { height: Math.max(day.deliveredValueVnd > 0 ? 4 : 0,
              day.deliveredValueVnd / maxValue * 92) }]} />
          </View>
          <Text style={s.chartDay}>{fmtDay(day.day)}</Text>
        </Pressable>)}
      </ScrollView>
      <Text style={s.section}>Chi tiết theo ngày</Text>
      <View style={s.tableHeader}>
        <Text style={[s.tableCell, s.dateCell]}>Ngày</Text>
        <Text style={s.tableCell}>Tạo</Text>
        <Text style={s.tableCell}>Giao</Text>
        <Text style={s.tableCell}>Hủy</Text>
        <Text style={[s.tableCell, s.moneyCell]}>Giá trị giao</Text>
      </View>
      {report.days.map(day => <Pressable key={day.day} accessibilityRole="button"
        accessibilityLabel={"Tra đơn giao ngày " + showDay(day.day)}
        onPress={() => onDrillDown("DELIVERED",
          { period: "custom", from: day.day, to: day.day })}
        style={s.tableRow}>
        <Text style={[s.tableCell, s.dateCell]}>{fmtDay(day.day)}</Text>
        <Text style={s.tableCell}>{day.createdCount}</Text>
        <Text style={s.tableCell}>{day.deliveredCount}</Text>
        <Text style={s.tableCell}>{day.canceledCount}</Text>
        <Text style={[s.tableCell, s.moneyCell]}>{money(day.deliveredValueVnd)}</Text>
      </Pressable>)}
      {totals && totals.createdCount === 0 && totals.deliveredCount === 0
        && totals.canceledCount === 0 && totals.failedCount === 0 &&
        <Text style={s.empty}>Chưa có đơn phát sinh trong kỳ này.</Text>}
    </View>}
  </View>;
}
const s = StyleSheet.create({
  page: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 22, gap: 10 },
  head: { minHeight: 46, flexDirection: "row", alignItems: "center", gap: 8 },
  back: { flexDirection: "row", minHeight: 44, alignItems: "center", gap: 4 },
  backText: { color: c.redDeep, fontSize: 12, fontWeight: "800" },
  title: { flex: 1, color: c.ink, fontSize: font.title, fontWeight: "800", textAlign: "center" },
  refresh: { minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" },
  caption: { fontSize: 12, color: c.secondary },
  center: { minHeight: 160, justifyContent: "center", alignItems: "center", gap: 10 },
  error: { gap: 8, paddingVertical: 14 },
  errorText: { fontSize: 13, color: c.redDeep },
  retry: { minHeight: 44, alignSelf: "flex-start", paddingHorizontal: 14,
    justifyContent: "center", backgroundColor: c.soft, borderRadius: 10 },
  retryText: { color: c.redDeep, fontWeight: "800" },
  content: { gap: 12 },
  section: { fontSize: font.note, color: c.ink, fontWeight: "900", paddingTop: 8, paddingBottom: 5 },
  metric: { minHeight: 51, flexDirection: "row", alignItems: "center",
    borderBottomWidth: 1, borderBottomColor: c.line, gap: 8 },
  metricCopy: { flex: 1, minWidth: 0, paddingVertical: 6 },
  metricLabel: { fontSize: 13, fontWeight: "700", color: c.ink },
  metricNote: { fontSize: 10, color: c.secondary },
  metricValue: { fontSize: 14, color: c.redDeep, fontWeight: "900", flexShrink: 1 },
  chevron: { fontSize: 22, color: c.secondary },
  disclaimer: { color: c.secondary, fontSize: 11, lineHeight: 16, paddingVertical: 7 },
  chart: { minHeight: 152, paddingHorizontal: 4, gap: 5, alignItems: "flex-end" },
  chartColumn: { width: 50, minHeight: 144, justifyContent: "flex-end",
    alignItems: "center", gap: 4 },
  chartValue: { fontSize: 10, color: c.secondary, fontWeight: "700" },
  barTrack: { height: 94, width: 32, justifyContent: "flex-end" },
  bar: { width: 32, backgroundColor: c.redDeep, borderRadius: 5 },
  chartDay: { fontSize: 10, color: c.secondary },
  tableHeader: { minHeight: 36, flexDirection: "row", alignItems: "center",
    backgroundColor: c.soft },
  tableRow: { minHeight: 44, flexDirection: "row", alignItems: "center",
    borderBottomWidth: 1, borderBottomColor: c.line },
  tableCell: { width: "11%", textAlign: "center", fontSize: 11, color: c.ink },
  dateCell: { width: "19%" },
  moneyCell: { width: "48%", textAlign: "right", paddingRight: 8, fontWeight: "700" },
  empty: { textAlign: "center", padding: 20, color: c.secondary, fontSize: 12 },
});
