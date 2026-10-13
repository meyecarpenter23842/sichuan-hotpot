import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { apiRequest, type CustomerOrderDetail, type CustomerOrderSummary } from "../api";
import { palette, typeScale } from "../theme";
import { vnd } from "../validation";

const statusLabel: Record<string, string> = {
  PENDING: "Đang chờ xác nhận",
  CONFIRMED: "Cửa hàng đã xác nhận",
  PREPARING: "Đang chuẩn bị",
  READY: "Đã sẵn sàng giao",
  DELIVERING: "Đang giao hàng",
  DELIVERED: "Đã giao thành công",
  CANCELED: "Đã hủy",
  DELIVERY_FAILED: "Giao không thành công",
};
const statusName = (status: string) => statusLabel[status] ?? "Đang cập nhật";
type Props = {
  accessToken: string;
  onLogin: () => void;
  onReorder: (order: CustomerOrderDetail) => string | null;
};

export function OrdersScreen({ accessToken, onLogin, onReorder }: Props) {
  const [orders, setOrders] = useState<CustomerOrderSummary[]>([]);
  const [detail, setDetail] = useState<CustomerOrderDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [reorderProblem, setReorderProblem] = useState("");
  const load = useCallback(async () => {
    if (!accessToken) return;
    setBusy(true);
    setProblem("");
    try {
      const rows = await apiRequest<CustomerOrderSummary[]>("/customer/orders", { accessToken });
      setOrders(rows);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Không tải được đơn hàng.");
    } finally { setBusy(false); }
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openOrder(id: string) {
    setBusy(true);
    setProblem("");
    setReorderProblem("");
    try {
      const next = await apiRequest<CustomerOrderDetail>("/customer/orders/" + encodeURIComponent(id), { accessToken });
      setDetail(next);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Không tải được chi tiết đơn.");
    } finally { setBusy(false); }
  }

  return (
    <View style={styles.content}>
      <Text style={styles.heading}>Đơn hàng của tôi</Text>
      {!accessToken ? (
        <>
          <Text style={styles.muted}>Đăng nhập để xem đơn hàng và theo dõi trạng thái.</Text>
          <Pressable style={styles.button} onPress={onLogin} accessibilityRole="button">
            <Text style={styles.buttonText}>Đăng nhập</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Pressable style={styles.outline} onPress={() => detail ? (setDetail(null), void load()) : void load()}
            accessibilityRole="button" disabled={busy}>
            <Text style={styles.outlineText}>{detail ? "‹ Danh sách đơn hàng" : "Làm mới trạng thái đơn"}</Text>
          </Pressable>
          {busy && <ActivityIndicator size="small" color={palette.red} />}
          {!!problem && <Text accessibilityRole="alert" style={styles.warning}>{problem}</Text>}
          {detail ? (
            <View style={styles.group}>
              <Text style={styles.headingSmall}>Đơn #{detail.id.slice(0, 8).toUpperCase()}</Text>
              <Text style={styles.status}>{statusName(detail.status)}</Text>
              <Text style={styles.muted}>Địa chỉ giao: {detail.addressLineSnapshot}</Text>
              {detail.items.map((item, index) => (
                <View key={index} style={styles.line}>
                  <View style={styles.fill}>
                    <Text style={styles.text}>{item.productName} × {item.quantity}</Text>
                    {!!item.variantName && <Text style={styles.muted}>{item.variantName}</Text>}
                    {!!item.modifiers.length && <Text style={styles.muted}>{item.modifiers.map(x => x.name).join(" · ")}</Text>}
                  </View>
                  <Text style={styles.text}>{vnd(item.lineTotalVnd)}</Text>
                </View>
              ))}
              <View style={styles.line}><Text style={styles.muted}>Tiền món</Text><Text style={styles.text}>{vnd(detail.subtotalVnd)}</Text></View>
              <View style={styles.line}><Text style={styles.muted}>Phí giao</Text><Text style={styles.text}>{vnd(detail.deliveryFeeVnd)}</Text></View>
              <View style={styles.line}><Text style={styles.headingSmall}>Tổng tiền</Text><Text style={styles.price}>{vnd(detail.totalVnd)}</Text></View>
              <Text style={styles.muted}>Thanh toán: {detail.payment?.method ?? "Chưa có"} · {detail.payment?.status === "CONFIRMED" ? "Đã xác nhận" : "Chờ đối soát"}</Text>
              <Text style={styles.headingSmall}>Tiến trình đơn</Text>
              {detail.statusHistory.map((event, index) => (
                <View key={index} style={styles.timeline}>
                  <Text style={styles.text}>• {statusName(event.toStatus)}</Text>
                  <Text style={styles.muted}>{new Date(event.createdAt).toLocaleString("vi-VN")}</Text>
                </View>
              ))}
              <Pressable style={styles.button} accessibilityRole="button"
                onPress={() => setReorderProblem(onReorder(detail) ?? "")}>
                <Text style={styles.buttonText}>Đặt lại các món</Text>
              </Pressable>
              {!!reorderProblem && <Text style={styles.warning} accessibilityRole="alert">{reorderProblem}</Text>}
            </View>
          ) : (
            <>
              {!busy && orders.length === 0 && <Text style={styles.muted}>Chưa có đơn hàng. Chọn món từ thực đơn để bắt đầu.</Text>}
              {orders.map(order => (
                <Pressable key={order.id} style={styles.order} onPress={() => void openOrder(order.id)}
                  accessibilityRole="button" accessibilityLabel={"Xem đơn " + order.id.slice(0, 8)}>
                  <View style={styles.line}>
                    <View style={styles.fill}>
                      <Text style={styles.headingSmall}>#{order.id.slice(0, 8).toUpperCase()}</Text>
                      <Text style={styles.muted}>{new Date(order.createdAt).toLocaleString("vi-VN")}</Text>
                      <Text style={styles.status}>{statusName(order.status)}</Text>
                    </View>
                    <Text style={styles.price}>{vnd(order.totalVnd)}</Text>
                  </View>
                </Pressable>
              ))}
            </>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingTop: 16, gap: 11 },
  heading: { fontSize: typeScale.page, fontWeight: "800", color: palette.text },
  headingSmall: { fontSize: typeScale.action, fontWeight: "800", color: palette.text },
  group: { gap: 11 },
  order: { borderRadius: 10, borderWidth: 1, borderColor: palette.line, padding: 12 },
  line: { flexDirection: "row", justifyContent: "space-between", gap: 10, alignItems: "center" },
  fill: { flex: 1 },
  text: { fontSize: typeScale.body, color: palette.text, fontWeight: "600", lineHeight: 19 },
  status: { color: palette.red, fontSize: typeScale.small, marginTop: 4, fontWeight: "700" },
  price: { color: palette.red, fontSize: typeScale.action, fontWeight: "800" },
  muted: { color: palette.muted, fontSize: typeScale.small, lineHeight: 18 },
  warning: { color: palette.red, fontSize: typeScale.body, lineHeight: 19 },
  timeline: { borderLeftWidth: 2, borderLeftColor: palette.line, paddingLeft: 10, gap: 3 },
  button: { minHeight: 46, borderRadius: 9, backgroundColor: palette.red, justifyContent: "center", alignItems: "center", padding: 10 },
  buttonText: { color: palette.white, fontSize: typeScale.action, fontWeight: "800" },
  outline: { minHeight: 46, borderRadius: 9, borderWidth: 1, borderColor: palette.line, justifyContent: "center", paddingHorizontal: 12 },
  outlineText: { color: palette.red, fontSize: typeScale.body, fontWeight: "700" },
});
