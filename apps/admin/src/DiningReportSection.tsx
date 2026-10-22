import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { request } from "./api";
import { c } from "./theme";

type Daily = {
  day: string; settledSessionCount: number; closedInvoiceVnd: number;
  ticketCount: number; rejectedQrCount: number; voidedTicketCount: number;
  cashCollectedVnd: number; qrCollectedVnd: number; refundedVnd: number;
  pendingQrVnd: number; voidedQrCount: number; netCollectedVnd: number;
};
type Report = {
  from: string; to: string; timezone: "Asia/Ho_Chi_Minh";
  invoiceDateField: "closedAt"; collectedDateField: "confirmedAt";
  refundDateField: string; shiftBasis: "NOT_AVAILABLE"; openTableCountNow: number;
  days: Daily[]; totals: Omit<Daily, "day">;
};
type Product = { productName: string; variantName: string | null;
  quantity: number; amountVnd: number };
type Collector = { staffId: string | null; method: string;
  paymentCount: number; collectedVnd: number };
type Page<T> = { items: T[]; hasMore: boolean; page: number; limit: number; note: string };
const fmt = (v: number) => v.toLocaleString("vi-VN") + "đ";
const number = (v: number) => v.toLocaleString("vi-VN");
const date = (v: string) => v.slice(8, 10) + "/" + v.slice(5, 7);

export function DiningReportSection({ token, branchId, from, to }: {
  token: string; branchId: string; from: string; to: string;
}) {
  const [report, setReport] = useState<Report | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [collectors, setCollectors] = useState<Collector[]>([]);
  const [productPage, setProductPage] = useState(0);
  const [collectorPage, setCollectorPage] = useState(0);
  const [hasMoreProducts, setHasMoreProducts] = useState(false);
  const [hasMoreCollectors, setHasMoreCollectors] = useState(false);
  const [loading, setLoading] = useState(true);
  const [paging, setPaging] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const version = useRef(0);
  const refresh = useCallback(() => setRevision(v => v + 1), []);
  const base = "/dining/reports/branches/" + branchId;
  const query = "from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to);
  useEffect(() => {
    let live = true;
    const id = ++version.current;
    setReport(null); setProducts([]); setCollectors([]);
    setProductPage(0); setCollectorPage(0);
    setLoading(true); setError(""); setHasMoreProducts(false); setHasMoreCollectors(false);
    void Promise.all([
      request<Report>(base + "?" + query, token),
      request<Page<Product>>(base + "/products?" + query + "&page=0&limit=20", token),
      request<Page<Collector>>(base + "/collectors?" + query + "&page=0&limit=20", token),
    ]).then(([summary, productRows, staffRows]) => {
      if (!live || id !== version.current) return;
      setReport(summary); setProducts(productRows.items); setCollectors(staffRows.items);
      setHasMoreProducts(productRows.hasMore); setHasMoreCollectors(staffRows.hasMore);
    }).catch(cause => {
      if (live && id === version.current)
        setError(cause instanceof Error ? cause.message : "Không tải được báo cáo tại quán.");
    }).finally(() => { if (live && id === version.current) setLoading(false); });
    return () => { live = false; version.current++; };
  }, [base, query, token, revision]);

  const more = (kind: "products" | "collectors") => {
    if (paging) return;
    const page = kind === "products" ? productPage + 1 : collectorPage + 1;
    const id = version.current;
    setPaging(true); setError("");
    const url = base + "/" + kind + "?" + query + "&page=" + page + "&limit=20";
    void request<Page<Product> & Page<Collector>>(url, token).then(data => {
      if (id !== version.current) return;
      if (kind === "products") {
        setProducts(items => [...items, ...data.items as Product[]]);
        setProductPage(page); setHasMoreProducts(data.hasMore);
      } else {
        setCollectors(items => [...items, ...data.items as Collector[]]);
        setCollectorPage(page); setHasMoreCollectors(data.hasMore);
      }
    }).catch(cause => {
      if (id === version.current)
        setError(cause instanceof Error ? cause.message : "Không tải được trang tiếp.");
    }).finally(() => { if (id === version.current) setPaging(false); });
  };
  const totals = report?.totals;
  const cards = totals ? [
    ["Hóa đơn đã đóng có món", number(totals.settledSessionCount)],
    ["Bàn đang có khách (hiện tại)", number(report?.openTableCountNow ?? 0)],
    ["Giá trị hóa đơn đã đóng", fmt(totals.closedInvoiceVnd)],
    ["Đã thu tiền mặt", fmt(totals.cashCollectedVnd)],
    ["Đã xác nhận QR", fmt(totals.qrCollectedVnd)],
    ["Khoản đã hoàn", "−" + fmt(totals.refundedVnd)],
    ["Tiền thực thu trong kỳ", fmt(totals.netCollectedVnd)],
    ["QR hiện còn chờ xác nhận*", fmt(totals.pendingQrVnd)],
    ["Số lượt gọi món", number(totals.ticketCount)],
    ["QR bị từ chối", number(totals.rejectedQrCount)],
    ["Phiếu được hủy có audit", number(totals.voidedTicketCount)],
    ["QR chờ đã hủy", number(totals.voidedQrCount)],
  ] : [];
  const max = Math.max(1, ...(report?.days.map(x => Math.max(0, x.netCollectedVnd)) ?? []));
  return <View style={s.wrap}>
    <View style={s.head}>
      <Text style={s.title}>Tại quán</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Làm mới báo cáo tại quán"
        onPress={refresh} style={s.refresh}><Text style={s.link}>Làm mới ↻</Text></Pressable>
    </View>
    <Text style={s.caption}>Giờ Việt Nam · 1 phiên bàn đã thanh toán = 1 hóa đơn, không phải số lượt gọi món</Text>
    {loading && <ActivityIndicator color={c.red} />}
    {!!error && <View style={s.alert}><Text style={s.error}>{error}</Text>
      <Pressable accessibilityRole="button" onPress={refresh}>
        <Text style={s.link}>Thử lại</Text></Pressable></View>}
    {report && <>
      <View style={s.metrics}>{cards.map(([label, value]) =>
        <View style={s.tile} key={label}>
          <Text style={s.caption}>{label}</Text>
          <Text style={s.value} numberOfLines={1}>{value}</Text>
        </View>)}</View>
      <Text style={s.caption}>Hóa đơn nhóm theo ngày đóng bàn. Tiền thu nhóm theo ngày nhân viên xác nhận; khoản hoàn trừ ở ngày thực hiện hoàn. QR chưa xác nhận không phải doanh thu. * Chỉ gồm khoản QR hiện vẫn PENDING tạo trong kỳ.</Text>
      <Text style={s.section}>Dòng tiền thực thu theo ngày</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.chart} accessibilityLabel="Biểu đồ thực thu tại quán theo ngày">
        {report.days.map(d => <View key={d.day} style={s.barColumn}>
          <Text style={s.small} numberOfLines={1}>{Math.round(d.netCollectedVnd / 1000)}k</Text>
          <View style={s.track}><View style={[s.bar,
            { height: Math.max(d.netCollectedVnd > 0 ? 4 : 0,
              Math.max(0, d.netCollectedVnd) / max * 88) }]} /></View>
          <Text style={s.small}>{date(d.day)}</Text>
        </View>)}
      </ScrollView>
      <Text style={s.section}>Doanh thu mặt hàng (theo hóa đơn đóng)</Text>
      {products.length === 0 ? <Text style={s.caption}>Chưa có món trong hóa đơn đã đóng.</Text> :
        products.map((p, i) => <View key={p.productName + "|" + p.variantName + "|" + i}
          style={s.line}>
          <View style={s.grow}><Text style={s.product}>{p.productName}</Text>
            {!!p.variantName && <Text style={s.caption}>{p.variantName}</Text>}
            <Text style={s.caption}>SL {number(p.quantity)} · Giá đã gồm lựa chọn/topping</Text>
          </View>
          <Text style={s.amount}>{fmt(p.amountVnd)}</Text>
        </View>)}
      {hasMoreProducts && <Pressable accessibilityRole="button" disabled={paging}
        style={s.more} onPress={() => more("products")}>
        <Text style={s.link}>{paging ? "Đang tải..." : "Xem thêm mặt hàng"}</Text></Pressable>}
      <Text style={s.section}>Nhân viên xác nhận thu tiền</Text>
      <Text style={s.caption}>Hiện chưa có dữ liệu ca làm việc để đối soát theo ca. Đây là khoản xác nhận theo nhân viên và thời điểm thu, không phải báo cáo ca.</Text>
      {collectors.length === 0 ? <Text style={s.caption}>Chưa có khoản thu đã xác nhận trong kỳ.</Text> :
        collectors.map((p, i) => <View key={(p.staffId ?? "unknown") + p.method + i} style={s.line}>
          <View style={s.grow}><Text style={s.product}>NV #{p.staffId?.slice(0, 8) ?? "không rõ"}</Text>
            <Text style={s.caption}>{p.method === "CASH" ? "Tiền mặt" : "QR"} · {p.paymentCount} giao dịch</Text>
          </View><Text style={s.amount}>{fmt(p.collectedVnd)}</Text>
        </View>)}
      {hasMoreCollectors && <Pressable accessibilityRole="button" disabled={paging}
        style={s.more} onPress={() => more("collectors")}>
        <Text style={s.link}>{paging ? "Đang tải..." : "Xem thêm nhân viên"}</Text></Pressable>}
      <Text style={s.caption}>Tiền theo nhân viên là khoản thu gốc đã xác nhận, chưa trừ các khoản hoàn phát sinh sau đó. Mọi khoản hoàn đã được trừ riêng trong số thực thu tổng.</Text>
    </>}
  </View>;
}
const s = StyleSheet.create({
  wrap: { gap: 10, paddingVertical: 10 },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { color: c.ink, fontSize: 15, fontWeight: "900" },
  refresh: { minWidth: 60, minHeight: 44, justifyContent: "center", alignItems: "flex-end" },
  link: { color: c.redDeep, fontSize: 12, fontWeight: "800" },
  caption: { color: c.secondary, fontSize: 11, lineHeight: 17 },
  error: { color: c.redDeep, fontSize: 12, lineHeight: 18 },
  alert: { gap: 7, padding: 10, borderWidth: 1, borderColor: c.line },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: { width: "48%", flexGrow: 1, padding: 12, minHeight: 77,
    borderRadius: 11, backgroundColor: c.soft, gap: 7 },
  value: { fontSize: 15, fontWeight: "900", color: c.redDeep },
  section: { fontSize: 14, fontWeight: "900", color: c.ink, marginTop: 7 },
  chart: { gap: 5, paddingHorizontal: 4, minHeight: 141, alignItems: "flex-end" },
  barColumn: { width: 50, gap: 5, alignItems: "center", justifyContent: "flex-end" },
  track: { width: 30, height: 90, justifyContent: "flex-end" },
  bar: { width: 30, backgroundColor: c.redDeep, borderRadius: 4 },
  small: { fontSize: 10, color: c.secondary },
  line: { flexDirection: "row", alignItems: "center", borderBottomWidth: 1,
    borderBottomColor: c.line, gap: 8, minHeight: 55, paddingVertical: 8 },
  grow: { flex: 1, minWidth: 0, gap: 4 },
  product: { color: c.ink, fontSize: 13, fontWeight: "700" },
  amount: { color: c.redDeep, fontSize: 13, fontWeight: "900" },
  more: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start", paddingHorizontal: 10 },
});
