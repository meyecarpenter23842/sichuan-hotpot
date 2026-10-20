import React, { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { API_ORIGIN, isValidApiOrigin } from "./src/api-origin";

type Connection = "loading" | "ready" | "unavailable" | "unconfigured";

const PRODUCT_TITLE = "Menu tại bàn";
const INTRO = "Thực đơn gọi món bằng QR đang được thiết lập. Mã QR chưa thể gửi yêu cầu món xuống quán trong phiên bản này.";
const WARNING = "Chưa nhận yêu cầu";

export default function App() {
  const { width } = useWindowDimensions();
  const wide = width >= 768;
  const [connection, setConnection] = useState<Connection>("loading");
  const [checking, setChecking] = useState(false);

  const checkConnection = useCallback(async () => {
    if (!isValidApiOrigin(API_ORIGIN)) { setConnection("unconfigured"); return; }
    setChecking(true);
    setConnection("loading");
    try {
      const response = await fetch(API_ORIGIN + "/health/ready", { method: "GET", cache: "no-store" });
      setConnection(response.ok ? "ready" : "unavailable");
    } catch {
      setConnection("unavailable");
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => { void checkConnection(); }, [checkConnection]);
  const connectionLabel = connection === "ready" ? "Máy chủ hoạt động" :
    connection === "loading" ? "Đang kiểm tra máy chủ…" :
    connection === "unconfigured" ? "Chưa có cấu hình API" : "Chưa kết nối được máy chủ";

  return <SafeAreaProvider><SafeAreaView style={styles.safe}>
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <View style={[styles.page, wide && styles.pageWide]}>
        <View style={styles.brandRow}>
          <View style={styles.brandMark}><Text style={styles.brandLetter}>L</Text></View>
          <View style={styles.brandCopy}>
            <Text style={styles.brandName}>Lẩu Tứ Xuyên &amp; Trà Sữa</Text>
            <Text style={styles.brandSub}>Sichuan Hotpot</Text>
          </View>
        </View>
        <View style={[styles.content, wide && styles.contentWide]}>
          <View style={styles.pill}><Text style={styles.pillText}>HỆ THỐNG ĐANG THIẾT LẬP</Text></View>
          <Text accessibilityRole="header" style={[styles.title, wide && styles.titleWide]}>{PRODUCT_TITLE}</Text>
          <Text style={styles.description}>{INTRO}</Text>
          <View style={styles.warning}><Text style={styles.warningText}>{WARNING}</Text></View>
          <View style={styles.statusRow}>
            <View style={[styles.dot, { backgroundColor: connection === "ready" ? "#248258" : "#B16A27" }]} />
            <Text style={styles.statusText}>{connectionLabel}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Kiểm tra kết nối máy chủ"
            accessibilityState={{ disabled: checking }}
            disabled={checking}
            onPress={() => { void checkConnection(); }}
            style={({ pressed }) => [styles.retry, pressed && !checking && styles.retryPressed, checking && styles.retryDisabled]}>
            <Text style={styles.retryText}>{checking ? "Đang kiểm tra…" : "Kiểm tra kết nối"}</Text>
          </Pressable>
          <Text style={styles.note}>Giai đoạn khởi tạo • Không có đơn hàng hoặc thanh toán thật được thực hiện từ trang này.</Text>
        </View>
        <Text style={styles.footer}>© Sichuan Hotpot • Nền tảng vận hành nội bộ</Text>
      </View>
    </ScrollView>
  </SafeAreaView></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#FAF8F6" },
  scroll: { flexGrow: 1 },
  page: { flex: 1, paddingHorizontal: 20, paddingTop: 30, paddingBottom: 32, maxWidth: 1120, width: "100%", alignSelf: "center" },
  pageWide: { paddingHorizontal: 44, paddingTop: 40 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  brandMark: { width: 46, height: 46, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "#8C2028" },
  brandLetter: { color: "#FFFFFF", fontWeight: "800", fontSize: 24 },
  brandCopy: { flex: 1 },
  brandName: { fontSize: 16, fontWeight: "700", color: "#3D2023" },
  brandSub: { color: "#866D6A", fontSize: 12, marginTop: 2 },
  content: { width: "100%", marginTop: 54, maxWidth: 670, alignSelf: "center", backgroundColor: "#FFFFFF", borderColor: "#E8DFDC", borderWidth: 1, borderRadius: 20, padding: 24 },
  contentWide: { marginTop: 76, paddingHorizontal: 46, paddingVertical: 42 },
  pill: { alignSelf: "flex-start", backgroundColor: "#F9E9E9", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  pillText: { color: "#8C2028", fontSize: 11, letterSpacing: 0.5, fontWeight: "700" },
  title: { fontSize: 30, fontWeight: "800", color: "#2B2020", marginTop: 24, lineHeight: 38 },
  titleWide: { fontSize: 40, lineHeight: 48 },
  description: { color: "#62565A", fontSize: 16, lineHeight: 26, marginTop: 12 },
  warning: { alignSelf: "flex-start", marginTop: 22, borderRadius: 9, backgroundColor: "#FFF1E3", paddingHorizontal: 14, paddingVertical: 10 },
  warningText: { color: "#89440F", fontWeight: "700", fontSize: 14 },
  statusRow: { marginTop: 30, flexDirection: "row", alignItems: "center", gap: 10 },
  dot: { height: 9, width: 9, borderRadius: 5 },
  statusText: { flexShrink: 1, fontSize: 14, color: "#5C5555" },
  retry: { borderWidth: 1, borderColor: "#8C2028", alignSelf: "flex-start", justifyContent: "center", alignItems: "center", marginTop: 20, minHeight: 48, borderRadius: 10, paddingHorizontal: 22 },
  retryPressed: { backgroundColor: "#FAEFEF" },
  retryDisabled: { opacity: 0.6 },
  retryText: { color: "#8C2028", fontWeight: "700", fontSize: 14 },
  note: { marginTop: 26, fontSize: 12, color: "#776E6F", lineHeight: 20 },
  footer: { marginTop: 42, textAlign: "center", color: "#857A77", fontSize: 12 },
});
