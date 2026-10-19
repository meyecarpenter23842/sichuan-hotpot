import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { request } from "./api";
import { Action, Notice } from "./ui";
import { c, font } from "./theme";

type CustomerRow = {
  id: string; phone: string | null; orderCount: number; lastOrderAt: string | null;
};
type CustomerPage = { items: CustomerRow[]; nextCursor: string | null };
type CustomerOrder = {
  id: string; status: string; createdAt: string; totalVnd: number;
  payment: { method: string; status: string } | null;
};
const date = (value: string) => new Date(value).toLocaleDateString("vi-VN");
const money = (value: number) => value.toLocaleString("vi-VN") + "đ";
const statusLabels: Record<string, string> = {
  PENDING: "Mới", CONFIRMED: "Đã nhận", PREPARING: "Đang nấu",
  READY: "Chờ giao", DELIVERING: "Đang giao", DELIVERED: "Đã giao",
  CANCELED: "Đã hủy", DELIVERY_FAILED: "Giao thất bại",
};

// Lives inside the existing Settings popup. No parallel navigation or extra dashboard.
export function CustomerPanel({ token, branchId }: { token: string; branchId: string }) {
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [moreBusy, setMoreBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<CustomerRow | null>(null);
  const [history, setHistory] = useState<CustomerOrder[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const generation = useRef(0);

  const load = useCallback(async (next: string | null = null) => {
    const seq = generation.current;
    if (next) setMoreBusy(true);
    else { setLoading(true); setCustomers([]); setCursor(null); }
    setError("");
    try {
      const page = await request<CustomerPage>(
        "/admin/orders/" + branchId + "/customers?limit=20" +
        (next ? "&cursor=" + encodeURIComponent(next) : ""), token);
      if (seq !== generation.current) return;
      setCustomers(existing => next ? [...existing, ...page.items] : page.items);
      setCursor(page.nextCursor);
    } catch (err) {
      if (seq === generation.current)
        setError(err instanceof Error ? err.message : "Không tải được khách hàng.");
    } finally {
      if (seq === generation.current) { setLoading(false); setMoreBusy(false); }
    }
  }, [branchId, token]);

  useEffect(() => {
    generation.current++;
    void load();
    return () => { generation.current++; };
  }, [load]);

  const showHistory = async (row: CustomerRow) => {
    setSelected(row); setHistory([]); setHistoryError(""); setHistoryBusy(true);
    const seq = generation.current;
    try {
      const response = await request<{ customerId: string; items: CustomerOrder[] }>(
        "/admin/orders/" + branchId + "/customers/" + encodeURIComponent(row.id), token);
      if (seq === generation.current) setHistory(response.items);
    } catch (err) {
      if (seq === generation.current) setHistoryError(
        err instanceof Error ? err.message : "Không tải được lịch sử.");
    } finally { if (seq === generation.current) setHistoryBusy(false); }
  };

  return <View style={styles.content}>
    {selected ? <>
      <View style={styles.bar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Quay lại khách hàng"
          onPress={() => { setSelected(null); setHistory([]); }} style={styles.back}>
          <Text style={styles.backText}>‹ Danh sách</Text>
        </Pressable>
        <Text style={styles.muted}>{selected.orderCount} đơn</Text>
      </View>
      <Text style={styles.name}>{selected.phone ?? "Khách hàng"}</Text>
      {historyBusy && <ActivityIndicator color={c.red} accessibilityLabel="Đang tải lịch sử mua" />}
      {!!historyError && <Notice text={historyError} error />}
      {!!historyError && <Action secondary label="Thử lại"
        onPress={() => { void showHistory(selected); }} />}
      {history.map(order => <View key={order.id} style={styles.line}>
        <View style={styles.lineTop}>
          <Text style={styles.primary}>#{order.id.slice(0, 8).toUpperCase()}</Text>
          <Text style={styles.muted}>{date(order.createdAt)}</Text>
        </View>
        <View style={styles.lineTop}>
          <Text style={styles.muted}>{statusLabels[order.status] ?? order.status}</Text>
          <Text style={styles.primary}>{money(order.totalVnd)}</Text>
        </View>
      </View>)}
      {!historyBusy && !historyError && !history.length &&
        <Text style={styles.muted}>Chưa có lịch sử mua tại chi nhánh này.</Text>}
      {history.length === 20 && <Text style={styles.muted}>Đang hiển thị 20 đơn gần nhất.</Text>}
    </> : <>
      {loading && <ActivityIndicator color={c.red} accessibilityLabel="Đang tải khách hàng" />}
      {!!error && <Notice text={error} error />}
      {!!error && <Action secondary label="Thử tải lại" onPress={() => { void load(); }} />}
      {!loading && !error && customers.length === 0 &&
        <Text style={styles.muted}>Chưa có khách đặt hàng tại chi nhánh này.</Text>}
      {customers.map(row => <Pressable key={row.id}
        accessibilityRole="button"
        accessibilityLabel={"Xem lịch sử khách " + (row.phone ?? row.id.slice(0, 8))}
        style={({ pressed }) => [styles.customer, pressed && styles.pressed]}
        onPress={() => { void showHistory(row); }}>
        <View style={styles.customerCopy}>
          <Text style={styles.name}>{row.phone ?? "Khách hàng"}</Text>
          <Text style={styles.muted}>
            {row.orderCount} đơn{row.lastOrderAt ? " · Mới nhất " + date(row.lastOrderAt) : ""}
          </Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>)}
      {!!cursor && <Action secondary label={moreBusy ? "Đang tải…" : "Xem thêm khách"}
        disabled={moreBusy || loading} onPress={() => { void load(cursor); }} />}
    </>}
  </View>;
}

const styles = StyleSheet.create({
  content: { gap: 10, minHeight: 80 },
  bar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  back: { minHeight: 44, justifyContent: "center", paddingHorizontal: 4 },
  backText: { color: c.red, fontSize: font.body, fontWeight: "700" },
  name: { fontSize: font.body, fontWeight: "700", color: c.ink },
  muted: { color: c.secondary, fontSize: font.note },
  customer: { minHeight: 58, flexDirection: "row", alignItems: "center",
    borderBottomColor: c.line, borderBottomWidth: 1, paddingVertical: 8, gap: 8 },
  customerCopy: { flex: 1, gap: 3 },
  pressed: { opacity: 0.7 },
  chevron: { fontSize: 25, color: c.secondary },
  line: { paddingVertical: 10, gap: 7, borderBottomWidth: 1, borderBottomColor: c.line },
  lineTop: { flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: 7 },
  primary: { color: c.ink, fontSize: font.note, fontWeight: "700" },
});
