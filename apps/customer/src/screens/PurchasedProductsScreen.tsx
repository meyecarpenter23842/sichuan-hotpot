import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { apiRequest, type CustomerOrderDetail, type CustomerOrderSummary } from "../api";
import { canReorderDeliveredOrder, historicalPurchaseKey } from "../../../../packages/shared/src/orders";
import { vnd } from "../validation";
import { actionDepth } from "../components/action-depth";
import { palette, typeScale } from "../theme";

type PurchasedItem = CustomerOrderDetail["items"][number];
type Purchase = { order: CustomerOrderDetail; item: PurchasedItem; key: string };
type Props = {
  accessToken: string;
  onLogin: () => void;
  onReorder: (order: CustomerOrderDetail) => string | null;
  active?: boolean;
  refreshSignal?: number;
};

/** Derived exclusively from delivered orders. Never cache old checkout prices as product prices. */
function uniquePurchases(orders: CustomerOrderDetail[]): Purchase[] {
  const unique = new Map<string, Purchase>();
  for (const order of orders) {
    if (!canReorderDeliveredOrder(order.status)) continue;
    for (const item of order.items) {
      const key = historicalPurchaseKey(order.branchId, item);
      if (!unique.has(key)) unique.set(key, { order, item, key });
    }
  }
  return [...unique.values()];
}

export function PurchasedProductsScreen({ accessToken, onLogin, onReorder,
  active = true, refreshSignal = 0 }: Props) {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reorderError, setReorderError] = useState("");
  const [revision, setRevision] = useState(0);
  const activeToken = useRef(accessToken);
  activeToken.current = accessToken;
  const [history, setHistory] = useState<CustomerOrderDetail[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const reload = useCallback(() => setRevision(n => n + 1), []);
  const fetchDelivered = useCallback(async (cursor?: string) => {
    const page = await apiRequest<{ items: CustomerOrderSummary[]; nextCursor: string | null }>(
      "/customer/orders/pages?delivered=1&limit=20"
      + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""), { accessToken });
    const details: CustomerOrderDetail[] = [];
    // Bound simultaneous detail requests; no unbounded waterfall or 50-order cap.
    for (let offset = 0; offset < page.items.length; offset += 3) {
      const rows = await Promise.all(page.items.slice(offset, offset + 3).map(order =>
        apiRequest<CustomerOrderDetail>("/customer/orders/" + encodeURIComponent(order.id),
          { accessToken })));
      details.push(...rows);
    }
    return { details, nextCursor: page.nextCursor };
  }, [accessToken]);
  useEffect(() => {
    if (!accessToken) {
      setPurchases([]); setHistory([]); setNextCursor(null);
      setError(""); setLoading(false); return;
    }
    if (!active) return;
    let mounted = true;
    // Never show the previous account's purchases while a new token loads.
    setHistory([]); setPurchases([]); setNextCursor(null);
    setLoading(true); setError(""); setReorderError("");
    void fetchDelivered().then(page => {
      if (!mounted) return;
      setHistory(page.details);
      setPurchases(uniquePurchases(page.details));
      setNextCursor(page.nextCursor);
    }).catch(e => {
      if (mounted) setError(e instanceof Error ? e.message : "Không tải được sản phẩm đã mua.");
    }).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [accessToken, active, revision, refreshSignal, fetchDelivered]);

  async function morePurchases() {
    if (!active || !nextCursor || loadingMore) return;
    const cursor = nextCursor;
    setLoadingMore(true); setError("");
    try {
      const page = await fetchDelivered(cursor);
      if (activeToken.current !== accessToken) return;
      // Server pagination produces distinct order IDs; deduplicate defensively.
      const seen = new Set(history.map(x => x.id));
      const combined = [...history, ...page.details.filter(x => !seen.has(x.id))];
      setHistory(combined);
      setPurchases(uniquePurchases(combined));
      setNextCursor(page.nextCursor);
    } catch (e) {
      if (activeToken.current === accessToken)
        setError(e instanceof Error ? e.message : "Không tải được lịch sử món cũ.");
    } finally { if (activeToken.current === accessToken) setLoadingMore(false); }
  }

  return (
    <View style={styles.page}>
      <Text style={styles.title}>Các món đã nhận</Text>
      <Text style={styles.muted}>Chọn món từng nhận để thêm lại vào giỏ. Giá, tùy chọn và tình trạng bán được kiểm tra theo thực đơn hiện tại.</Text>
      {!accessToken ? (
        <Pressable accessibilityRole="button" style={[styles.reorderButton, actionDepth.primary]}
          onPress={onLogin}><Text style={styles.reorderText}>Đăng nhập để xem món đã mua</Text></Pressable>
      ) : (
        <>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: loading }}
            disabled={loading} style={styles.reload} onPress={reload}>
            <Text style={styles.reloadText}>Làm mới sản phẩm đã mua</Text>
          </Pressable>
          {loading && <ActivityIndicator color={palette.red} />}
          {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
          {!loading && !error && purchases.length === 0 &&
            <Text style={styles.empty}>Chưa có món từ đơn đã giao. Các món đã nhận sẽ xuất hiện tại đây.</Text>}
          {purchases.map(purchase => (
            <View key={purchase.key} style={styles.card}>
              <View style={styles.cardCopy}>
                <Text style={styles.name}>{purchase.item.productName}</Text>
                <Text style={styles.muted}>Lần mua gần nhất: {purchase.item.quantity} phần</Text>
                {!purchase.item.productId && <Text style={styles.unavailable}>
                  Món này không còn trong thực đơn hiện tại; chỉ hiển thị lịch sử đã mua.
                </Text>}
                {!!purchase.item.variantName && <Text style={styles.muted}>{purchase.item.variantName}</Text>}
                {purchase.item.modifiers.length > 0 &&
                  <Text style={styles.muted}>Topping: {purchase.item.modifiers.map(x => x.name).join(" · ")}</Text>}
                {purchase.item.comboItems.length > 0 &&
                  <View style={styles.comboChoices}>
                    {purchase.item.comboItems.map((component, index) =>
                      <Text key={index} style={styles.muted}>
                        • {component.groupName ? component.groupName + ": " : ""}
                        {component.quantity} × {component.productName}
                        {component.variantName ? " · " + component.variantName : ""}
                      </Text>)}
                  </View>}
                <Text style={styles.note}>Đã mua: {vnd(purchase.item.lineTotalVnd)} · Giá và tình trạng bán hiện tại sẽ được kiểm tra lại</Text>
              </View>
              <Pressable accessibilityRole="button"
                accessibilityLabel={"Mua lại " + purchase.item.productName}
                disabled={!purchase.item.productId}
                accessibilityState={{ disabled: !purchase.item.productId }}
                style={[styles.reorderButton, actionDepth.primary,
                  !purchase.item.productId && styles.buttonDisabled]}
                onPress={() => {
                  if (!canReorderDeliveredOrder(purchase.order.status)) {
                    setReorderError("Chỉ được mua lại món từ đơn đã giao thành công.");
                    return;
                  }
                  setReorderError(onReorder({ ...purchase.order, items: [purchase.item] }) ?? "");
                }}>
                <Text style={styles.reorderText}>
                  {purchase.item.productId ? "＋ Mua lại " + purchase.item.quantity + " phần" : "Ngừng bán"}
                </Text>
              </Pressable>
            </View>
          ))}
          {!!reorderError && <Text accessibilityRole="alert" style={styles.error}>{reorderError}</Text>}
          {!!nextCursor && <Pressable accessibilityRole="button"
            accessibilityLabel="Tải thêm món đã mua từ đơn cũ" disabled={loadingMore}
            accessibilityState={{ disabled: loadingMore }} style={styles.reload}
            onPress={() => void morePurchases()}>
            <Text style={styles.reloadText}>{loadingMore ? "Đang tải đơn cũ..." : "Xem thêm món đã mua"}</Text>
          </Pressable>}
          <Text style={styles.footerNote}>Món từ các đơn đã giao thành công; có thể tải thêm lịch sử cũ. Giá hiện tại được kiểm tra khi mua lại.</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 26, gap: 13 },
  title: { fontSize: typeScale.page, fontWeight: "800", color: palette.text },
  muted: { fontSize: typeScale.small, color: palette.muted, lineHeight: 18 },
  empty: { borderRadius: 13, padding: 15, backgroundColor: palette.graySurface,
    color: palette.muted, fontSize: typeScale.body, lineHeight: 21 },
  error: { color: palette.red, fontSize: typeScale.body, lineHeight: 19 },
  unavailable: { color: "#A34213", fontSize: typeScale.small, lineHeight: 18 },
  buttonDisabled: { backgroundColor: palette.muted, opacity: 0.68 },
  reload: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  reloadText: { fontSize: typeScale.body, color: palette.red, fontWeight: "700" },
  card: { borderBottomWidth: 1, borderBottomColor: palette.line,
    paddingVertical: 14, gap: 10 },
  cardCopy: { gap: 5 },
  comboChoices: { paddingVertical: 4, paddingLeft: 8, gap: 3 },
  name: { color: palette.text, fontWeight: "800", fontSize: typeScale.action },
  note: { color: palette.muted, fontSize: typeScale.small },
  reorderButton: { backgroundColor: palette.red, borderRadius: 11,
    minHeight: 44, alignSelf: "flex-start", paddingHorizontal: 16,
    justifyContent: "center", alignItems: "center" },
  reorderText: { color: palette.white, fontWeight: "800", fontSize: typeScale.body },
  footerNote: { color: palette.muted, fontSize: typeScale.small, lineHeight: 17 },
});
