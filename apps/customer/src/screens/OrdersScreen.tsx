import { displayAdministrativeSelection } from "../../../../packages/shared/src/vietnam-admin";
import { canReorderDeliveredOrder } from "../../../../packages/shared/src/orders";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { apiRequest, type CustomerOrderDetail, type CustomerOrderSummary } from "../api";
import { watchCustomerOrderEvents } from "../order-realtime";
import { palette, typeScale } from "../theme";
import { RecoverableImage } from "../components/RecoverableImage";
import { actionDepth } from "../components/action-depth";
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
  focusOrderId?: string | null;
  onOrderEvent?: () => void;
};

export function OrdersScreen({ accessToken, onLogin, onReorder, focusOrderId, onOrderEvent }: Props) {
  const [orders, setOrders] = useState<CustomerOrderSummary[]>([]);
  const [detail, setDetail] = useState<CustomerOrderDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [reorderProblem, setReorderProblem] = useState("");
  const selectedOrderId = useRef<string | null>(null);
  const load = useCallback(async (silent = false) => {
    if (!accessToken) return;
    if (!silent) { setBusy(true); setProblem(""); }
    try {
      const rows = await apiRequest<CustomerOrderSummary[]>("/customer/orders", { accessToken });
      setOrders(rows);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Không tải được đơn hàng.");
    } finally { if (!silent) setBusy(false); }
  }, [accessToken]);

  const openOrder = useCallback(async (id: string, silent = false) => {
    if (!accessToken) return;
    selectedOrderId.current = id;
    if (!silent) {
      setBusy(true);
      setProblem("");
      setReorderProblem("");
    }
    try {
      const next = await apiRequest<CustomerOrderDetail>(
        "/customer/orders/" + encodeURIComponent(id), { accessToken },
      );
      if (selectedOrderId.current === id) setDetail(next);
    } catch (error) {
      if (selectedOrderId.current === id) {
        setProblem(error instanceof Error ? error.message : "Không tải được chi tiết đơn.");
      }
    } finally { if (!silent) setBusy(false); }
  }, [accessToken]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (focusOrderId && accessToken) void openOrder(focusOrderId);
  }, [focusOrderId, accessToken, openOrder]);

  const detailId = detail?.id ?? null;
  useEffect(() => {
    if (!accessToken) return;
    return watchCustomerOrderEvents(accessToken, () => {
      // Keep list and selected detail fresh, including when the purchases tab is visible.
      void load(true);
      if (selectedOrderId.current) void openOrder(selectedOrderId.current, true);
      onOrderEvent?.();
    });
  }, [accessToken, load, openOrder, onOrderEvent]);
  useEffect(() => {
    if (!accessToken) return;
    const refresh = () => {
      if (detailId) void openOrder(detailId, true);
      else void load(true);
    };
    const timer = setInterval(() => {
      if (Platform.OS === "web"
        ? (typeof document !== "undefined" && document.visibilityState === "visible")
        : AppState.currentState === "active") refresh();
    }, 20_000);
    const subscription = AppState.addEventListener("change", state => {
      if (state === "active") refresh();
    });
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    if (Platform.OS === "web" && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisible);
    }
    return () => {
      clearInterval(timer);
      subscription.remove();
      if (Platform.OS === "web" && typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisible);
      }
    };
  }, [accessToken, detailId, load, openOrder]);

  return (
    <View style={styles.content}>
      <Text style={styles.heading}>Đơn hàng của tôi</Text>
      {!accessToken ? (
        <>
          <Text style={styles.muted}>Đăng nhập để xem đơn hàng và theo dõi trạng thái.</Text>
          <Pressable style={[styles.button, actionDepth.primary]} onPress={onLogin} accessibilityRole="button">
            <Text style={styles.buttonText}>Đăng nhập</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Pressable style={styles.outline} onPress={() => detail ? (selectedOrderId.current = null, setDetail(null), void load()) : void load()}
            accessibilityRole="button" disabled={busy}>
            <Text style={styles.outlineText}>{detail ? "‹ Danh sách đơn hàng" : "Làm mới trạng thái đơn"}</Text>
          </Pressable>
          {busy && <ActivityIndicator size="small" color={palette.red} />}
          {!!problem && <Text accessibilityRole="alert" style={styles.warning}>{problem}</Text>}
          {detail ? (
            <View style={styles.group}>
              <Text style={styles.headingSmall}>Đơn #{detail.id.slice(0, 8).toUpperCase()}</Text>
              <Text style={styles.status}>{statusName(detail.status)}</Text>
              <Text style={styles.muted}>Địa chỉ giao: {detail.addressLineSnapshot}{displayAdministrativeSelection({
                catalogVersion: detail.catalogVersionSnapshot,
                provinceCode: detail.provinceCodeSnapshot,
                wardCode: detail.wardCodeSnapshot,
              }) ? ", " + displayAdministrativeSelection({
                catalogVersion: detail.catalogVersionSnapshot,
                provinceCode: detail.provinceCodeSnapshot,
                wardCode: detail.wardCodeSnapshot,
              }) : ""}</Text>
              {!!detail.customerNote && <View style={styles.noteBox}>
                <Text style={styles.noteTitle}>Ghi chú cho cửa hàng</Text>
                <Text style={styles.text}>{detail.customerNote}</Text>
              </View>}
              {detail.items.map((item, index) => (
                <View key={index} style={styles.line}>
                  <View style={styles.fill}>
                    <Text style={styles.text}>{item.productName} × {item.quantity}</Text>
                    {!!item.variantName && <Text style={styles.muted}>{item.variantName}</Text>}
                    {!!item.comboItems.length && <View style={styles.comboSnapshot}>
                      {item.comboItems.map((component, componentIndex) =>
                        <Text key={componentIndex} style={styles.muted}>
                          {component.kind === "FIXED" ? "• " : "• " + (component.groupName ? component.groupName + ": " : "")}
                          {component.quantity} × {component.productName}
                          {component.variantName ? " · " + component.variantName : ""}
                          {component.priceDeltaVnd > 0 ? " · +" + vnd(component.priceDeltaVnd) : ""}
                        </Text>)}
                    </View>}
                    {!!item.modifiers.length && <Text style={styles.muted}>{item.modifiers.map(x => x.name).join(" · ")}</Text>}
                  </View>
                  <Text style={styles.text}>{vnd(item.lineTotalVnd)}</Text>
                </View>
              ))}
              <View style={styles.line}><Text style={styles.muted}>Tiền món</Text><Text style={styles.text}>{vnd(detail.subtotalVnd)}</Text></View>
              <View style={styles.line}><Text style={styles.muted}>Phí giao</Text><Text style={styles.text}>{vnd(detail.deliveryFeeVnd)}</Text></View>
              <View style={styles.line}><Text style={styles.headingSmall}>Tổng tiền</Text><Text style={styles.price}>{vnd(detail.totalVnd)}</Text></View>
              <Text style={styles.muted}>Thanh toán: {detail.payment?.method ?? "Chưa có"} · {detail.payment?.status === "CONFIRMED" ? "Đã xác nhận" : "Chờ đối soát"}</Text>
              {detail.payment?.qr && detail.payment.status === "PENDING" && (
                <View style={styles.qrPanel}>
                  <Text style={styles.headingSmall}>Quét mã VietQR chuyển khoản</Text>
                  <RecoverableImage uri={detail.payment.qr.imageUrl}
                    style={styles.qrImage} resizeMode="contain"
                    accessibilityLabel="Mã QR chuyển khoản theo số tiền đơn hàng" />
                  <Text style={styles.text}>Ngân hàng BIN: {detail.payment.qr.bankBin}</Text>
                  <Text style={styles.text}>Số tài khoản: {detail.payment.qr.accountNo}</Text>
                  <Text style={styles.text}>Chủ tài khoản: {detail.payment.qr.accountName}</Text>
                  <Text style={styles.text}>Số tiền: {vnd(detail.payment.qr.amountVnd)}</Text>
                  <Text style={styles.text}>Nội dung: {detail.payment.qr.transferReference}</Text>
                  <Text style={styles.muted}>Vui lòng kiểm tra kỹ tài khoản nhận trước khi chuyển. Đơn chỉ được xác nhận đã thanh toán sau khi cửa hàng đối soát.</Text>
                </View>
              )}
              <Text style={styles.headingSmall}>Tiến trình đơn</Text>
              {detail.statusHistory.map((event, index) => (
                <View key={index} style={styles.timeline}>
                  <Text style={styles.text}>• {statusName(event.toStatus)}</Text>
                  {!!event.reason && <Text style={styles.muted}>Lý do: {event.reason}</Text>}
                  <Text style={styles.muted}>{new Date(event.createdAt).toLocaleString("vi-VN")}</Text>
                </View>
              ))}
              {canReorderDeliveredOrder(detail.status) ? (
                <Pressable style={[styles.button, actionDepth.primary]} accessibilityRole="button"
                  accessibilityLabel="Đặt lại các món trong đơn đã giao"
                  onPress={() => {
                    if (!canReorderDeliveredOrder(detail.status)) return;
                    setReorderProblem(onReorder(detail) ?? "");
                  }}>
                  <Text style={styles.buttonText}>Đặt lại các món</Text>
                </Pressable>
              ) : (
                <Text style={styles.reorderHint}>
                  Chỉ có thể đặt lại khi đơn đã giao thành công. Anh/chị vẫn có thể theo dõi tiến trình ở trên.
                </Text>
              )}
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
  content: { paddingHorizontal: 16, paddingTop: 16, gap: 11, paddingBottom: 12 },
  heading: { fontSize: typeScale.page, fontWeight: "800", color: palette.text },
  headingSmall: { fontSize: typeScale.action, fontWeight: "800", color: palette.text },
  group: { gap: 11 },
  order: { borderBottomWidth: 1, borderBottomColor: palette.line,
    paddingVertical: 15, paddingHorizontal: 2, minHeight: 74 },
  line: { flexDirection: "row", justifyContent: "space-between", gap: 10, alignItems: "center" },
  fill: { flex: 1 },
  comboSnapshot: { gap: 2, paddingTop: 3 },
  noteBox: { gap: 4, padding: 10, borderRadius: 9, backgroundColor: "#FFF8EC",
    borderWidth: 1, borderColor: "#F1E2C7" },
  noteTitle: { color: palette.red, fontSize: typeScale.small, fontWeight: "800" },
  text: { fontSize: typeScale.body, color: palette.text, fontWeight: "600", lineHeight: 19 },
  status: { color: palette.red, fontSize: typeScale.small, marginTop: 4, fontWeight: "700" },
  price: { color: palette.red, fontSize: typeScale.action, fontWeight: "800" },
  muted: { color: palette.muted, fontSize: typeScale.small, lineHeight: 18 },
  warning: { color: palette.red, fontSize: typeScale.body, lineHeight: 19 },
  reorderHint: { color: palette.muted, fontSize: typeScale.body, lineHeight: 20,
    paddingVertical: 8, borderTopWidth: 1, borderTopColor: palette.line },
  qrPanel: { borderRadius: 10, backgroundColor: palette.graySurface, padding: 12, gap: 8 },
  qrImage: { width: "100%", height: 305 },
  timeline: { borderLeftWidth: 2, borderLeftColor: palette.line, paddingLeft: 10, gap: 3 },
  button: { minHeight: 46, borderRadius: 9, backgroundColor: palette.red, justifyContent: "center", alignItems: "center", padding: 10 },
  buttonText: { color: palette.white, fontSize: typeScale.action, fontWeight: "800" },
  outline: { minHeight: 46, borderRadius: 9, borderWidth: 1, borderColor: palette.line, justifyContent: "center", paddingHorizontal: 12 },
  outlineText: { color: palette.red, fontSize: typeScale.body, fontWeight: "700" },
});
