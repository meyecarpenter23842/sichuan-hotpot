import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { checkoutCartItems, type CartLine } from "../../../../packages/shared/src/cart";
import {
  apiRequest, type CheckoutReceipt, type DeliveryQuote, type PaymentMethods,
} from "../api";
import { palette, typeScale } from "../theme";
import { actionDepth } from "../components/action-depth";
import { vnd } from "../validation";

const PENDING_KEY = "hotpot.checkout.pending.v1";
type PaymentMethod = "COD" | "QR";
type PendingIntent = { fingerprint: string; idempotencyKey: string };
type Props = {
  accessToken: string;
  userId: string;
  branchId: string;
  branchActive: boolean;
  addressId: string | null;
  cart: readonly CartLine[];
  onPlaced: (receipt: CheckoutReceipt) => void;
};

export function CheckoutPanel({ accessToken, userId, branchId, branchActive, addressId, cart, onPlaced }: Props) {
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("COD");
  const [qrAvailable, setQrAvailable] = useState(false);
  const [quote, setQuote] = useState<DeliveryQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [closedPopup, setClosedPopup] = useState(false);
  const lock = useRef(false);
  const items = useMemo(() => {
    try { return checkoutCartItems(cart); } catch { return null; }
  }, [cart]);
  const fingerprint = useMemo(() => JSON.stringify({
    userId, branchId, addressId, paymentMethod, items,
  }), [userId, branchId, addressId, paymentMethod, items]);

  useEffect(() => {
    let active = true;
    apiRequest<PaymentMethods>("/customer/orders/payment-methods", { accessToken })
      .then(methods => { if (active) setQrAvailable(methods.qrAvailable); })
      .catch(() => { if (active) setQrAvailable(false); });
    return () => { active = false; };
  }, [accessToken]);
  useEffect(() => { if (!qrAvailable && paymentMethod === "QR") setPaymentMethod("COD"); },
    [qrAvailable, paymentMethod]);

  // A cart/address change invalidates even a not-yet-expired server quote.
  useEffect(() => { setQuote(null); setProblem(""); }, [fingerprint]);

  async function requestQuote() {
    if (!branchActive) { setClosedPopup(true); return; }
    if (lock.current || !addressId || !branchId || !items) return;
    lock.current = true;
    setBusy(true);
    setQuote(null);
    setProblem("");
    try {
      const result = await apiRequest<DeliveryQuote>("/customer/delivery/quote", {
        method: "POST", accessToken, body: { branchId, addressId, items },
      });
      setQuote(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không tính được phí giao hàng.";
      if (message.includes("quán đã nghỉ")) setClosedPopup(true);
      else setProblem(message);
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }

  async function placeOrder() {
    if (!branchActive) { setClosedPopup(true); return; }
    if (lock.current || !addressId || !branchId || !items || !quote
        || (paymentMethod === "QR" && !qrAvailable)) return;
    if (quote.addressId !== addressId || quote.branchId !== branchId
        || Date.parse(quote.quoteExpiresAt) <= Date.now()) {
      setQuote(null);
      setProblem("Báo phí đã hết hạn. Vui lòng tính lại trước khi đặt.");
      return;
    }
    lock.current = true;
    setBusy(true);
    setProblem("");
    try {
      // Reuse the exact same key after timeout/restart so a retry cannot
      // create a second order. Never store credentials or prices locally.
      let pending: PendingIntent | null = null;
      const raw = await AsyncStorage.getItem(PENDING_KEY);
      if (raw) {
        const candidate: unknown = JSON.parse(raw);
        if (candidate && typeof candidate === "object"
            && "fingerprint" in candidate && "idempotencyKey" in candidate) {
          const known = candidate as PendingIntent;
          if (known.fingerprint === fingerprint
              && /^[0-9a-f-]{36}$/i.test(known.idempotencyKey)) pending = known;
          else {
            throw new Error("Có lượt đặt hàng trước chưa được xác nhận. Kiểm tra Đơn hàng trước khi tạo đơn khác.");
          }
        }
      }
      if (!pending) {
        pending = { fingerprint, idempotencyKey: Crypto.randomUUID() };
        await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(pending));
      }
      const receipt = await apiRequest<CheckoutReceipt>("/customer/orders", {
        method: "POST", accessToken,
        body: {
          branchId, addressId, items,
          idempotencyKey: pending.idempotencyKey, paymentMethod,
        },
      });
      await AsyncStorage.removeItem(PENDING_KEY);
      onPlaced(receipt);
    } catch (error) {
      // Preserve the intent on uncertainty; never assume a failed HTTP
      // response means that the server failed to commit the order.
      const message = error instanceof Error ? error.message : "Không xác nhận được đơn. Kiểm tra lịch sử đơn.";
      if (message.includes("quán đã nghỉ")) setClosedPopup(true);
      else setProblem(message);
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }

  return (
    <View style={styles.panel}>
      <Text style={styles.heading}>Thanh toán & phí giao</Text>
      {!branchActive && <Text style={styles.warning}>Quán đã nghỉ. Bạn vẫn có thể xem món và giữ giỏ hàng.</Text>}
      {!addressId && <Text style={styles.warning}>Lưu và chọn địa chỉ giao hàng trong tài khoản trước khi đặt.</Text>}
      <Text style={styles.label}>Phương thức thanh toán</Text>
      <View style={styles.methods}>
        {(["COD", "QR"] as const).map(method => (
          <Pressable key={method} accessibilityRole="radio"
            accessibilityState={{ checked: paymentMethod === method }}
            accessibilityLabel={method === "COD" ? "Thanh toán tiền mặt khi nhận" : "Chuyển khoản QR chờ xác nhận"}
            style={[styles.method, paymentMethod === method && styles.selected]}
            disabled={busy || (method === "QR" && !qrAvailable)}
            onPress={() => setPaymentMethod(method)}>
            <Text style={[styles.methodText, paymentMethod === method && styles.active]}>
              {method === "COD" ? "COD · Tiền mặt" : "QR · Chuyển khoản"}
            </Text>
          </Pressable>
        ))}
      </View>
      {!qrAvailable && <Text style={styles.subtle}>QR chưa được cửa hàng cấu hình. Anh/chị vẫn có thể thanh toán COD.</Text>}
      {paymentMethod === "QR" && (
        <Text style={styles.subtle}>Chuyển khoản cần mã QR/tài khoản của cửa hàng. Đơn ở trạng thái chờ xác nhận, không tự đánh dấu đã thanh toán.</Text>
      )}
      <Pressable accessibilityRole="button" style={[styles.action, (busy || !addressId || !items) && styles.disabled]}
        disabled={busy || !addressId || !items} onPress={() => void requestQuote()}>
        {busy ? <ActivityIndicator color={palette.white} /> :
          <Text style={styles.actionText}>{quote ? "Tính lại phí giao" : "Tính phí giao theo đường xe chạy"}</Text>}
      </Pressable>
      {!!quote && (
        <View style={styles.summary}>
          <View style={styles.row}><Text style={styles.subtle}>Tạm tính từ máy chủ</Text><Text style={styles.value}>{vnd(quote.subtotalVnd)}</Text></View>
          <View style={styles.row}><Text style={styles.subtle}>Đường xe chạy</Text><Text style={styles.value}>{(quote.routeDistanceMeters / 1000).toFixed(2)} km</Text></View>
          <View style={styles.row}><Text style={styles.subtle}>Phí giao</Text><Text style={styles.value}>{vnd(quote.feeVnd)}</Text></View>
          <View style={styles.row}><Text style={styles.totalLabel}>Tổng thanh toán</Text><Text style={styles.total}>{vnd(quote.totalVnd)}</Text></View>
          <Text style={styles.subtle}>Báo phí có hạn. Máy chủ sẽ tính và kiểm tra lại khi tạo đơn.</Text>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }}
            style={[styles.action, actionDepth.primary, busy && styles.disabled]} disabled={busy}
            onPress={() => void placeOrder()}>
            <Text style={styles.actionText}>{busy ? "Đang gửi đơn..." : "Xác nhận đặt đơn " + paymentMethod}</Text>
          </Pressable>
        </View>
      )}
      {!!problem && <Text style={styles.warning} accessibilityRole="alert">{problem}</Text>}
      <Modal visible={closedPopup} transparent animationType="fade" onRequestClose={() => setClosedPopup(false)}>
        <View style={styles.closedOverlay}>
          <View style={styles.closedDialog}>
            <Text style={styles.heading}>Quán hiện đã nghỉ</Text>
            <Text style={styles.subtle}>Cửa hàng đang tạm ngừng nhận đơn. Món và giỏ hàng của bạn vẫn được giữ lại; vui lòng đặt khi quán mở cửa trở lại.</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Đã hiểu, đóng thông báo quán nghỉ"
              style={styles.action} onPress={() => setClosedPopup(false)}>
              <Text style={styles.actionText}>Đã hiểu</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 11, paddingVertical: 14, borderTopColor: palette.line, borderTopWidth: 1 },
  heading: { fontSize: typeScale.section, fontWeight: "800", color: palette.text },
  label: { fontSize: typeScale.body, fontWeight: "700", color: palette.text },
  methods: { flexDirection: "row", gap: 8 },
  method: { flex: 1, minHeight: 46, borderWidth: 1, borderColor: palette.line, borderRadius: 9, alignItems: "center", justifyContent: "center", padding: 8 },
  selected: { borderColor: palette.red, backgroundColor: palette.softRed },
  methodText: { fontSize: typeScale.small, fontWeight: "700", color: palette.muted },
  active: { color: palette.red },
  action: { minHeight: 46, borderRadius: 9, backgroundColor: palette.red, alignItems: "center", justifyContent: "center", paddingHorizontal: 12, paddingVertical: 10 },
  actionText: { color: palette.white, fontWeight: "800", fontSize: typeScale.action, textAlign: "center" },
  disabled: { opacity: 0.5 },
  summary: { gap: 9, padding: 12, backgroundColor: palette.graySurface, borderRadius: 10 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 10, alignItems: "center" },
  subtle: { color: palette.muted, fontSize: typeScale.small, lineHeight: 18, flexShrink: 1 },
  value: { color: palette.text, fontSize: typeScale.body, fontWeight: "600" },
  totalLabel: { color: palette.text, fontSize: typeScale.action, fontWeight: "800" },
  total: { color: palette.red, fontSize: typeScale.section, fontWeight: "900" },
  warning: { color: palette.red, fontSize: typeScale.body, lineHeight: 19 },
  closedOverlay: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24, backgroundColor: "rgba(0,0,0,0.45)" },
  closedDialog: { width: "100%", maxWidth: 400, padding: 20, gap: 16, borderRadius: 14, backgroundColor: palette.white },
});
