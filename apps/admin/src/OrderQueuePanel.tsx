import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, AppState, Modal, Pressable, ScrollView, StyleSheet,
  Text, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Field, Notice, Action, Pill } from "./ui";
import { Icon } from "./Icon";
import { request } from "./api";
import { markNewOrderAlerted, playOrderChime } from "./order-notifications";
import { watchOrderEvents } from "./order-realtime";
import { c, font } from "./theme";

export type OrderStatus =
  "PENDING" | "CONFIRMED" | "PREPARING" | "READY" |
  "DELIVERING" | "DELIVERED" | "CANCELED" | "DELIVERY_FAILED";
type ActionStatus = "CONFIRMED" | "CANCELED" | "PREPARING" | "READY";

export interface StaffOrder {
  id: string; branchId: string; status: OrderStatus; createdAt: string; updatedAt: string;
  subtotalVnd?: number; deliveryFeeVnd?: number; totalVnd?: number;
  payment?: { method: "COD" | "QR"; status: string } | null;
  items: {
    productName: string; variantName: string | null; quantity: number;
    unitPriceVnd?: number; lineTotalVnd?: number;
    modifiers: { name: string; priceVnd?: number }[];
  }[];
}
interface OrderDetail extends StaffOrder {
  phoneSnapshot?: string | null; addressLineSnapshot?: string | null;
  roadDistanceMeters?: number;
  statusHistory: {
    fromStatus: OrderStatus | null; toStatus: OrderStatus;
    createdAt: string; reason: string | null;
  }[];
}

const statusName: Record<OrderStatus, string> = {
  PENDING: "Đơn mới", CONFIRMED: "Đã nhận", PREPARING: "Đang chế biến",
  READY: "Chờ giao", DELIVERING: "Đang giao", DELIVERED: "Hoàn thành",
  CANCELED: "Đã hủy", DELIVERY_FAILED: "Giao thất bại",
};
const money = (n: number) => n.toLocaleString("vi-VN") + "đ";
const when = (date: string) => new Date(date).toLocaleString("vi-VN", {
  day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
});
function availableActions(status: OrderStatus, role: string): { value: ActionStatus; label: string }[] {
  const manager = role === "OWNER" || role === "MANAGER";
  const kitchen = manager || role === "KITCHEN";
  if (status === "PENDING" && manager) return [
    { value: "CONFIRMED", label: "Xác nhận đơn" },
    { value: "CANCELED", label: "Từ chối đơn" },
  ];
  if (status === "CONFIRMED") return [
    ...(kitchen ? [{ value: "PREPARING" as const, label: "Bắt đầu chế biến" }] : []),
    ...(manager ? [{ value: "CANCELED" as const, label: "Hủy đơn" }] : []),
  ];
  if (status === "PREPARING" && kitchen) return [
    { value: "READY", label: "Báo món đã sẵn sàng" },
  ];
  return [];
}
const kitchenStatuses: OrderStatus[] = ["CONFIRMED", "PREPARING", "READY"];
const deliveryStatuses: OrderStatus[] = ["READY", "DELIVERING", "DELIVERED", "DELIVERY_FAILED"];

export function OrderQueuePanel({ token, branchId, role, mode, active, chimeEnabled }: {
  token: string; branchId: string; role: string; mode: "orders" | "kitchen" | "delivery"; active: boolean;
  chimeEnabled: boolean;
}) {
  const kitchenOnly = role === "KITCHEN";
  const [orders, setOrders] = useState<StaffOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [clock, setClock] = useState(Date.now());
  const [selected, setSelected] = useState<OrderDetail | null>(null);
  const [opening, setOpening] = useState(false);
  const [action, setAction] = useState<ActionStatus | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState<"active" | "all">("active");
  const requestId = useRef(0);
  const lastIds = useRef<Set<string> | null>(null);
  const pendingAlerts = useRef<Set<string>>(new Set());

  const sync = useCallback(async () => {
    const current = ++requestId.current;
    setSyncing(true);
    try {
      const fresh = await request<StaffOrder[]>("/admin/orders/" + branchId, token);
      if (current !== requestId.current) return;
      const pending = fresh.filter(x => x.status === "PENDING");
      if (lastIds.current) {
        const newcomers = pending.filter(x => !lastIds.current?.has(x.id));
        const unseen = newcomers.filter(x => {
          if (pendingAlerts.current.has(x.id)) return false;
          pendingAlerts.current.add(x.id);
          return true;
        });
        if (unseen.length) {
          setNotice("Có " + unseen.length + " đơn mới. Kiểm tra và xác nhận.");
          if (chimeEnabled && !kitchenOnly
            && unseen.some(item => markNewOrderAlerted(branchId, item.id))) playOrderChime();
        }
      }
      lastIds.current = new Set(pending.map(x => x.id));
      setOrders(fresh); setError(""); setLastSync(new Date());
    } catch (e) {
      if (current === requestId.current) {
        setError(e instanceof Error ? e.message : "Mất kết nối với máy chủ.");
      }
    } finally {
      if (current === requestId.current) { setLoading(false); setSyncing(false); }
    }
  }, [branchId, token, chimeEnabled, kitchenOnly]);

  useEffect(() => {
    requestId.current++;
    lastIds.current = null;
    pendingAlerts.current.clear();
    setOrders([]); setLastSync(null); setLoading(true); setNotice(""); setError("");
    if (active) void sync();
    return () => { requestId.current++; };
  }, [active, branchId, sync]);

  useEffect(() => {
    if (!active) return;
    const clockTick = setInterval(() => setClock(Date.now()), 60000);
    return () => clearInterval(clockTick);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => {
      if (AppState.currentState === "active") void sync();
    }, 10000);
    const sub = AppState.addEventListener("change", next => {
      if (next === "active") void sync();
    });
    return () => { clearInterval(interval); sub.remove(); };
  }, [active, sync]);

  useEffect(() => {
    if (!active || !token) return;
    return watchOrderEvents({
      token, branchId,
      onReady: () => { void sync(); },
      onChange: event => {
        if (event.type === "order.overdue" && !kitchenOnly) {
          setNotice("Có đơn chờ xác nhận quá 5 phút. Vui lòng kiểm tra.");
        }
        void sync();
      },
    });
  }, [active, token, branchId, kitchenOnly, sync]);

  const openDetail = async (id: string) => {
    setOpening(true); setNotice(""); setSelected(null); setAction(null); setReason("");
    try {
      const detail = await request<OrderDetail>("/admin/orders/" + branchId + "/" + id, token);
      setSelected(detail);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được đơn hàng.");
    } finally { setOpening(false); }
  };
  const save = async () => {
    if (!selected || !action || saving) return;
    if (action === "CANCELED" && reason.trim().length < 5) {
      setError("Cần nhập lý do hủy/từ chối ít nhất 5 ký tự."); return;
    }
    setSaving(true); setError("");
    try {
      await request("/admin/orders/" + branchId + "/" + selected.id + "/status",
        token, "PATCH", { expectedStatus: selected.status, toStatus: action,
          ...(action === "CANCELED" ? { reason: reason.trim() } : {}) });
      setSelected(null); setAction(null); setReason("");
      setNotice("Đã cập nhật trạng thái đơn và ghi lịch sử.");
      await sync();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Không cập nhật được đơn.";
      setError(message + " Hãy tải lại đơn để kiểm tra trạng thái hiện tại.");
      setAction(null); setSelected(null); await sync();
    } finally { setSaving(false); }
  };

  const visible = orders.filter(order => {
    if (mode === "kitchen") return kitchenStatuses.includes(order.status);
    if (mode === "delivery") return deliveryStatuses.includes(order.status);
    return filter === "all" || !["DELIVERED", "CANCELED", "DELIVERY_FAILED"].includes(order.status);
  });
  const pendingCount = orders.filter(x => x.status === "PENDING").length;
  const overdueCount = orders.filter(x => x.status === "PENDING"
    && clock - Date.parse(x.createdAt) >= 300000).length;
  const kitchenCount = orders.filter(x => x.status === "PREPARING").length;
  const deliveryCount = orders.filter(x => x.status === "DELIVERING").length;
  const deliveredCount = orders.filter(x => x.status === "DELIVERED").length;

  return <View style={s.page}>
    <View style={s.head}>
      <View style={s.headInfo}>
        <Text style={s.title}>{mode === "kitchen" ? "Phiếu bếp"
          : mode === "delivery" ? "Giao hàng" : "Đơn hàng"}</Text>
        <Text style={s.note}>{mode === "delivery"
          ? "Trạng thái đơn từ máy chủ. Phân công tài xế triển khai ở P5."
          : "Đơn thật · cập nhật tức thời khi có kết nối, đồng bộ dự phòng 10 giây"}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Đồng bộ đơn hàng"
        disabled={syncing} onPress={() => void sync()} style={s.refresh}>
        <Icon name="clock" color={syncing ? c.secondary : c.red} size={21} />
      </Pressable>
    </View>
    <View style={s.summary}>
      {(mode === "delivery" ? [
        ["Chờ giao", orders.filter(x => x.status === "READY").length],
        ["Đang giao", deliveryCount],
        ["Đã giao", deliveredCount],
      ] : [
        ["Đơn mới", pendingCount],
        ["Đang nấu", kitchenCount],
        ["Chờ giao", orders.filter(x => x.status === "READY").length],
      ]).map(([label, value], index) => <View key={String(label)}
        style={[s.summaryMetric, index === 0 && s.summaryMetricHot]}>
        <Text style={s.summaryNum}>{value}</Text>
        <Text style={s.note}>{label}</Text>
      </View>)}
    </View>
    <Text style={[s.sync, error && s.syncError]}>
      {error ? "Mất đồng bộ — dữ liệu có thể đã cũ" :
        syncing ? "Đang đồng bộ..." :
        lastSync ? "Đã đồng bộ lúc " + lastSync.toLocaleTimeString("vi-VN") : "Chưa đồng bộ"}
    </Text>
    {!!error && <Notice error text={error} />}
    {!!notice && <Notice text={notice} />}
    {overdueCount > 0 && !kitchenOnly && <Notice error
      text={overdueCount + " đơn đang chờ xác nhận quá 5 phút. Cần xử lý ngay."} />}
    {mode === "orders" && <View style={s.filter}>
      <Pill label="Đang xử lý" active={filter === "active"} onPress={() => setFilter("active")} />
      <Pill label="Tất cả" active={filter === "all"} onPress={() => setFilter("all")} />
    </View>}
    {loading ? <ActivityIndicator color={c.red} style={{ marginVertical: 30 }} /> :
      visible.length === 0 ? <View style={s.empty}>
        <View style={s.emptyIcon}>
          <Icon name={mode === "kitchen" ? "kitchen" :
            mode === "delivery" ? "delivery" : "orders"} color={c.red} size={29} />
        </View>
        <Text style={s.emptyHeading}>
          {mode === "kitchen" ? "Bếp chưa có phiếu cần xử lý"
            : mode === "delivery" ? "Chưa có đơn trong danh sách giao"
            : "Chưa có đơn hàng trong nhóm này"}
        </Text>
        <Text style={s.note}>Danh sách chỉ hiển thị dữ liệu thật từ máy chủ.</Text>
      </View> : <View style={s.rows}>
        {visible.map(order => <View key={order.id} style={s.orderCard}>
          <View style={s.orderHeader}>
            <Text style={s.orderId}>#{order.id.slice(0, 8).toUpperCase()}</Text>
            <View style={[s.statusPill, order.status === "PENDING" && s.statusPillUrgent]}>
              <Text style={[s.status, order.status === "PENDING" && s.urgent]}>
                {statusName[order.status]}
              </Text>
            </View>
            <View style={{ flex: 1 }} />
            <Icon name="clock" size={16} color={c.secondary} />
            <Text style={s.date}>{when(order.createdAt)}</Text>
          </View>
          <View style={s.cardContent}>
            <View style={s.cardDishIcon}>
              <Icon name="kitchen" size={25} color={c.redDeep} />
            </View>
            <View style={s.cardProducts}>
              {order.items.slice(0, 3).map((item, idx) =>
                <Text key={idx} numberOfLines={1} style={s.productLine}>
                  {item.quantity} × {item.productName}
                </Text>)}
              {order.items.length > 3 && <Text style={s.note}>
                + {order.items.length - 3} món khác
              </Text>}
            </View>
            {!kitchenOnly && order.totalVnd !== undefined && <View style={s.cardTotal}>
              <Text style={s.note}>Tổng tiền</Text>
              <Text style={s.total}>{money(order.totalVnd)}</Text>
              {!!order.payment?.method &&
                <Text style={s.paymentChip}>{order.payment.method}</Text>}
            </View>}
          </View>
          <Pressable accessibilityRole="button"
            accessibilityLabel={"Xem đơn " + order.id.slice(0, 8)}
            style={({ pressed }) => [s.detailButton, pressed && s.pressed]}
            onPress={() => void openDetail(order.id)}>
            <Icon name="orders" size={19} color={c.redDeep} />
            <Text style={s.detailButtonLabel}>
              {mode === "kitchen" ? "Xem phiếu & xử lý bếp"
                : mode === "delivery" ? "Xem trạng thái giao hàng" : "Xem chi tiết & xử lý"}
            </Text>
            <Text style={s.detailButtonArrow}>›</Text>
          </Pressable>
        </View>)}
      </View>}
    {opening && <ActivityIndicator color={c.red} />}
    <Modal visible={!!selected} transparent animationType="slide"
      onRequestClose={() => { if (!saving) { setSelected(null); setAction(null); } }}>
      <SafeAreaView edges={["bottom"]} style={s.overlay}>
        <View style={s.sheet}>
          <View style={s.sheetHead}>
            <Text style={s.title}>Đơn #{selected?.id.slice(0, 8).toUpperCase()}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Đóng chi tiết đơn"
              disabled={saving} onPress={() => { setSelected(null); setAction(null); }}
              style={s.close}>
              <Icon name="close" size={19} color={c.ink} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={s.sheetContent} keyboardShouldPersistTaps="handled">
            {selected && <>
              <View style={s.detailStatusRow}>
                <View style={s.statusPill}><Text style={s.status}>{statusName[selected.status]}</Text></View>
                <Text style={s.note}>Đặt lúc {when(selected.createdAt)}</Text>
              </View>
              <View style={s.timeline}>
                {(["PENDING", "CONFIRMED", "PREPARING", "READY"] as const).map((status, index) => {
                  const history = selected.statusHistory.find(row => row.toStatus === status);
                  const reachedAt = status === "PENDING" ? selected.createdAt : history?.createdAt;
                  return <View style={s.timelineStep} key={status}>
                    <View style={[s.timelineDot, reachedAt && s.timelineDone]}>
                      {reachedAt && <Icon name="check" size={14} color={c.white} />}
                    </View>
                    <Text style={[s.timelineLabel, reachedAt && s.timelineLabelDone]} numberOfLines={2}>
                      {["Mới đặt", "Đã nhận", "Đang nấu", "Sẵn sàng"][index]}
                    </Text>
                    <Text style={s.timelineClock}>
                      {reachedAt ? new Date(reachedAt).toLocaleTimeString("vi-VN",{
                        hour:"2-digit", minute:"2-digit",
                      }) : "--:--"}
                    </Text>
                  </View>;
                })}
              </View>
              <Text style={s.detailSectionTitle}>Danh sách món ({selected.items.length} dòng món)</Text>
              {selected.items.map((item, i) => <View key={i} style={s.item}>
                <View style={s.itemOrdinal}><Text style={s.itemOrdinalLabel}>{i + 1}</Text></View>
                <View style={s.rowTop}>
                  <Text style={s.itemName}>{item.quantity} × {item.productName}</Text>
                  {!kitchenOnly && item.lineTotalVnd !== undefined &&
                    <Text style={s.products}>{money(item.lineTotalVnd)}</Text>}
                </View>
                {!!item.variantName && <Text style={s.note}>{item.variantName}</Text>}
                {item.modifiers.map((m,j) =>
                  <Text key={j} style={s.note}>+ {m.name}
                    {!kitchenOnly && m.priceVnd !== undefined ? " (" + money(m.priceVnd) + ")" : ""}
                  </Text>)}
              </View>)}
              {!kitchenOnly && selected.subtotalVnd !== undefined &&
                selected.deliveryFeeVnd !== undefined && selected.totalVnd !== undefined &&
                <View style={s.totals}>
                  <Text style={s.note}>Tiền món: {money(selected.subtotalVnd)}</Text>
                  <Text style={s.note}>Phí giao: {money(selected.deliveryFeeVnd)}</Text>
                  <Text style={s.total}>Tổng thu: {money(selected.totalVnd)}</Text>
                  <Text style={s.note}>Thanh toán: {selected.payment?.method ?? "Chưa xác định"}
                    {" · "}{selected.payment?.status ?? "Chưa xác định"}</Text>
                </View>}
              {!!selected.addressLineSnapshot && <>
                <Text style={s.itemName}>Giao tới</Text>
                <Text style={s.products}>{selected.addressLineSnapshot}</Text>
                {!!selected.phoneSnapshot && <Text style={s.note}>{selected.phoneSnapshot}</Text>}
              </>}
              <Text style={s.detailSectionTitle}>Lịch sử trạng thái</Text>
              {selected.statusHistory.map((h,i) =>
                <Text key={i} style={s.note}>
                  {when(h.createdAt)} · {statusName[h.toStatus]}
                  {h.reason ? " · " + h.reason : ""}
                </Text>)}
              {availableActions(selected.status, role).length > 0 && <View style={s.actions}>
                {!action ? availableActions(selected.status, role).map(a =>
                  <Action key={a.value} label={a.label}
                    secondary={a.value === "CANCELED"} onPress={() => setAction(a.value)} />) : <>
                  <Text style={s.itemName}>Xác nhận: {statusName[action]}?</Text>
                  {action === "CANCELED" && <Field label="Lý do bắt buộc"
                    value={reason} onChangeText={setReason}
                    placeholder="Nêu rõ lý do cho khách" multiline />}
                  <Action label={saving ? "Đang cập nhật..." : "Xác nhận cập nhật"}
                    disabled={saving || (action === "CANCELED" && reason.trim().length < 5)}
                    onPress={() => void save()} />
                  <Action label="Quay lại" secondary disabled={saving}
                    onPress={() => setAction(null)} />
                </>}
              </View>}
            </>}
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  </View>;
}

const s = StyleSheet.create({
  page: { paddingHorizontal: 12, paddingTop: 14, paddingBottom: 24, gap: 12 },
  head: { flexDirection: "row", gap: 10, alignItems: "center" },
  headInfo: { flex: 1, gap: 5 },
  title: { fontSize: font.title, fontWeight: "800", color: c.ink },
  note: { fontSize: font.note, color: c.secondary, lineHeight: 18 },
  refresh: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  summary: { flexDirection: "row", borderBottomWidth: 1, borderColor: c.line,
    paddingBottom: 10, gap: 5 },
  summaryMetric: { flex: 1, gap: 5, paddingHorizontal: 6, paddingVertical: 8,
    alignItems: "center", borderRadius: 10 },
  summaryNum: { fontSize: 18, fontWeight: "800", color: c.ink },
  sync: { fontSize: font.caption, color: c.green },
  syncError: { color: c.red },
  filter: { flexDirection: "row", gap: 8 },
  rows: { gap: 4 },
  row: { paddingVertical: 13, paddingHorizontal: 4, gap: 7,
    borderBottomWidth: 1, borderColor: c.line, minHeight: 100 },
  pressed: { opacity: 0.6 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", gap: 10 },
  orderId: { fontWeight: "900", color: c.ink, fontSize: 16 },
  date: { color: c.secondary, fontSize: font.caption },
  status: { color: c.green, fontWeight: "700", fontSize: font.note },
  urgent: { color: c.red },
  total: { fontWeight: "900", color: c.red, fontSize: 15 },
  products: { color: c.secondary, fontSize: font.note, lineHeight: 19, flexShrink: 1 },
  empty: { minHeight: 250, justifyContent: "center", alignItems: "center",
    gap: 12, padding: 20 },
  overlay: { flex: 1, backgroundColor: "rgba(12,18,28,0.48)",
    justifyContent: "flex-end" },
  sheet: { maxHeight: "92%", backgroundColor: c.white,
    borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: "hidden" },
  sheetHead: { minHeight: 56, flexDirection: "row", justifyContent: "space-between",
    alignItems: "center", paddingHorizontal: 16, borderBottomWidth: 1, borderColor: c.line },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  sheetContent: { padding: 16, paddingBottom: 30, gap: 12 },
  item: { gap: 3, borderBottomWidth: 1, borderColor: c.line, paddingBottom: 9 },
  itemName: { fontSize: font.body, fontWeight: "700", color: c.ink, flexShrink: 1 },
  totals: { gap: 4, paddingVertical: 10, borderBottomWidth: 1, borderColor: c.line },
  actions: { paddingTop: 10, gap: 10 },
  summaryMetricHot: { backgroundColor: "#FFE9EB", borderRadius: 12 },
  orderCard: { backgroundColor: c.white, borderRadius: 15, borderColor: "#EFE3D9",
    borderWidth: 1, padding: 12, gap: 12, marginBottom: 9,
    shadowColor: "#45231B", shadowOpacity: 0.07, shadowRadius: 6, elevation: 2 },
  orderHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusPill: { backgroundColor: "#F5EFE6", borderRadius: 13,
    paddingVertical: 5, paddingHorizontal: 10 },
  statusPillUrgent: { backgroundColor: "#FFE5E9" },
  cardContent: { flexDirection: "row", alignItems: "center", gap: 10 },
  cardDishIcon: { width: 46, height: 51, borderRadius: 10,
    backgroundColor: "#FFF1DF", alignItems: "center", justifyContent: "center" },
  cardProducts: { flex: 1, minWidth: 0, gap: 4 },
  productLine: { fontSize: 12, color: c.ink, fontWeight: "600", lineHeight: 17 },
  cardTotal: { alignItems: "flex-end", gap: 3 },
  paymentChip: { color: "#8E581B", backgroundColor: "#FFF2D8",
    fontSize: 10, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  detailButton: { backgroundColor: "#FCE6E7", borderRadius: 9,
    minHeight: 45, flexDirection: "row", alignItems: "center",
    justifyContent: "center", gap: 10, paddingHorizontal: 12 },
  detailButtonLabel: { fontSize: 12, fontWeight: "800", color: c.redDeep },
  detailButtonArrow: { color: c.redDeep, fontSize: 21, marginLeft: "auto" },
  emptyIcon: { width: 58, height: 58, borderRadius: 29, backgroundColor: "#FCE6E7",
    alignItems: "center", justifyContent: "center" },
  emptyHeading: { fontSize: 14, fontWeight: "800", color: c.ink },
  detailStatusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  timeline: { backgroundColor: "#FFF9F3", paddingVertical: 15, paddingHorizontal: 8,
    flexDirection: "row", borderRadius: 12, borderWidth: 1, borderColor: "#F2E7D9" },
  timelineStep: { flex: 1, alignItems: "center", gap: 7 },
  timelineDot: { width: 32, height: 32, borderRadius: 16, backgroundColor: "#E5E5E9",
    alignItems: "center", justifyContent: "center" },
  timelineDone: { backgroundColor: c.red },
  timelineLabel: { color: c.secondary, fontSize: 10, textAlign: "center", fontWeight: "600" },
  timelineLabelDone: { color: c.red, fontWeight: "800" },
  timelineClock: { color: c.secondary, fontSize: 10 },
  detailSectionTitle: { fontSize: 15, fontWeight: "800", color: c.ink,
    paddingLeft: 9, borderLeftWidth: 4, borderLeftColor: c.red },
  itemOrdinal: { alignItems: "center", justifyContent: "center", width: 24, height: 24,
    borderRadius: 12, backgroundColor: "#FCE5E7" },
  itemOrdinalLabel: { fontSize: 12, fontWeight: "800", color: c.red },
});
