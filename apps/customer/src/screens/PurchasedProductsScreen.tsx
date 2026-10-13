import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { apiRequest, type CustomerOrderDetail, type CustomerOrderSummary } from "../api";
import { actionDepth } from "../components/action-depth";
import { palette, typeScale } from "../theme";

type PurchasedItem = CustomerOrderDetail["items"][number];
type Purchase = { order: CustomerOrderDetail; item: PurchasedItem; key: string };
type Props = {
  accessToken: string;
  onLogin: () => void;
  onReorder: (order: CustomerOrderDetail) => string | null;
};

/** Derived exclusively from delivered orders. Never cache old checkout prices as product prices. */
function uniquePurchases(orders: CustomerOrderDetail[]): Purchase[] {
  const unique = new Map<string, Purchase>();
  for (const order of orders) {
    for (const item of order.items) {
      if (!item.productId) continue;
      const key = JSON.stringify([item.productId, item.variantName,
        item.modifiers.map(option => option.name)]);
      if (!unique.has(key)) unique.set(key, { order, item, key });
    }
  }
  return [...unique.values()];
}

export function PurchasedProductsScreen({ accessToken, onLogin, onReorder }: Props) {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reorderError, setReorderError] = useState("");
  const [revision, setRevision] = useState(0);

  const reload = useCallback(() => setRevision(n => n + 1), []);
  useEffect(() => {
    if (!accessToken) {
      setPurchases([]);
      return;
    }
    let active = true;
    async function load() {
      setLoading(true);
      setError("");
      setReorderError("");
      try {
        const summaries = await apiRequest<CustomerOrderSummary[]>("/customer/orders", { accessToken });
        const delivered = summaries.filter(order => order.status === "DELIVERED").slice(0, 20);
        const details: CustomerOrderDetail[] = [];
        // Bounded requests: do not overwhelm the order API with large purchase histories.
        for (let offset = 0; offset < delivered.length; offset += 3) {
          const results = await Promise.allSettled(delivered.slice(offset, offset + 3).map(order =>
            apiRequest<CustomerOrderDetail>("/customer/orders/" + encodeURIComponent(order.id),
              { accessToken })));
          if (!active) return;
          for (const result of results) {
            if (result.status === "fulfilled") details.push(result.value);
            else throw result.reason;
          }
        }
        if (active) setPurchases(uniquePurchases(details));
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Không tải được sản phẩm đã mua.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [accessToken, revision]);

  return (
    <View style={styles.page}>
      <Text style={styles.title}>Sản phẩm đã mua</Text>
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
          {!loading && purchases.map(purchase => (
            <View key={purchase.key} style={styles.card}>
              <View style={styles.cardCopy}>
                <Text style={styles.name}>{purchase.item.productName}</Text>
                {!!purchase.item.variantName && <Text style={styles.muted}>{purchase.item.variantName}</Text>}
                {purchase.item.modifiers.length > 0 &&
                  <Text style={styles.muted}>{purchase.item.modifiers.map(x => x.name).join(" · ")}</Text>}
                <Text style={styles.note}>Giá mới được kiểm tra khi thêm giỏ và đặt hàng</Text>
              </View>
              <Pressable accessibilityRole="button"
                accessibilityLabel={"Mua lại " + purchase.item.productName}
                style={[styles.reorderButton, actionDepth.primary]}
                onPress={() => setReorderError(onReorder({
                  ...purchase.order, items: [purchase.item],
                }) ?? "")}>
                <Text style={styles.reorderText}>＋ Mua lại</Text>
              </Pressable>
            </View>
          ))}
          {!!reorderError && <Text accessibilityRole="alert" style={styles.error}>{reorderError}</Text>}
          <Text style={styles.footerNote}>Hiển thị món trong tối đa 20 đơn đã giao gần nhất thuộc danh sách đơn hàng được máy chủ trả về.</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 26, gap: 13 },
  title: { fontSize: typeScale.page, fontWeight: "800", color: palette.text },
  muted: { fontSize: typeScale.small, color: palette.muted, lineHeight: 18 },
  empty: { borderRadius: 13, padding: 15, backgroundColor: palette.graySurface,
    color: palette.muted, fontSize: typeScale.body, lineHeight: 21 },
  error: { color: palette.red, fontSize: typeScale.body, lineHeight: 19 },
  reload: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  reloadText: { fontSize: typeScale.body, color: palette.red, fontWeight: "700" },
  card: { borderRadius: 15, borderWidth: 1, borderColor: palette.line,
    backgroundColor: palette.white, padding: 13, gap: 12 },
  cardCopy: { gap: 5 },
  name: { color: palette.text, fontWeight: "800", fontSize: typeScale.action },
  note: { color: palette.muted, fontSize: typeScale.small },
  reorderButton: { backgroundColor: palette.red, borderRadius: 11,
    minHeight: 44, alignSelf: "flex-start", paddingHorizontal: 16,
    justifyContent: "center", alignItems: "center" },
  reorderText: { color: palette.white, fontWeight: "800", fontSize: typeScale.body },
  footerNote: { color: palette.muted, fontSize: typeScale.small, lineHeight: 17 },
});
