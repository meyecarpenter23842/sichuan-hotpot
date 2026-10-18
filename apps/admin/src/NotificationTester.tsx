import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { adminPushTestStatus, adminTestLocalSound, adminTestRemotePush,
  listenAdminTestReceipts, type PushTestStatus } from "./push-client";

export function NotificationTester({ token, branchId }: { token: string; branchId: string }) {
  const [status, setStatus] = useState<PushTestStatus | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("Chưa chạy kiểm thử.");
  const [error, setError] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const current = useRef<string | null>(null);
  const received = useRef(new Set<string>());
  const lastPush = useRef(0);
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const stop = listenAdminTestReceipts(token, id => {
      received.current.add(id);
      if (current.current === id) {
        setConfirmed(true); setError(false);
        setMessage("ĐÃ NHẬN FCM thực tế trên thiết bị khi ứng dụng mở.");
      }
    });
    void adminPushTestStatus().then(setStatus).catch(() => undefined);
    return stop;
  }, [token]);
  async function execute(mode: "status" | "sound" | "push" | "full") {
    if (busy) return;
    if ((mode === "push" || mode === "full") && Date.now() - lastPush.current < 30000) {
      setError(true); setMessage("Giới hạn: 30 giây giữa hai lần gửi FCM."); return;
    }
    setBusy(mode); setError(false); setConfirmed(false);
    try {
      if (mode === "status") {
        setStatus(await adminPushTestStatus());
        setMessage("Đã kiểm tra cấu hình, chưa kiểm tra việc nhận push thực tế.");
      } else if (mode === "sound") {
        await adminTestLocalSound();
        setMessage("Đã yêu cầu phát âm cục bộ bằng thông báo Android. Hãy nghe trực tiếp trên thiết bị.");
      } else {
        lastPush.current = Date.now();
        current.current = null;
        const id = await adminTestRemotePush(token, branchId);
        current.current = id;
        if (received.current.has(id)) {
          setConfirmed(true); setMessage("ĐÃ NHẬN FCM thực tế trên thiết bị.");
        } else {
          setMessage("FCM đã nhận yêu cầu gửi" + (mode === "full" ? " kèm âm thanh" : "") +
            ". CHƯA xác nhận thiết bị nhận. Quan sát banner/âm và kiểm tra khi nền hoặc đóng thường.");
        }
        setStatus(await adminPushTestStatus());
      }
    } catch (cause) {
      setError(true);
      setMessage(cause instanceof Error ? cause.message : "Không xác định được lỗi kiểm thử.");
    } finally { setBusy(""); }
  }
  if (Platform.OS !== "android") return <Text style={s.hint}>
    Chức năng test FCM và âm riêng dành cho APK Android; PWA dùng Web Push.
  </Text>;
  return <View style={s.root} testID="admin-fcm-test">
    <Text style={s.title}>Kiểm tra thông báo và âm thanh</Text>
    {([
      ["Quyền thông báo", status?.permission],
      ["Firebase", status?.firebase],
      ["FCM token", status?.token],
      ["Âm thanh", status?.sound],
    ] as const).map(([name, value]) => <View key={name} style={s.line}>
      <Text style={s.label}>{name}</Text>
      <Text style={s.value}>{value ?? "Chưa kiểm tra"}</Text>
    </View>)}
    <View style={s.actions}>
      {([
        ["status", "Làm mới"], ["sound", "Test âm thanh"],
        ["push", "Test thông báo"], ["full", "Test đầy đủ"],
      ] as const).map(([mode, label]) => <Pressable key={mode}
        accessibilityRole="button" accessibilityLabel={label} disabled={!!busy}
        onPress={() => void execute(mode)} style={[s.button, !!busy && s.disabled]}>
        {busy === mode ? <ActivityIndicator size="small" color="#B3262D"/> :
          <Text style={s.buttonText}>{label}</Text>}
      </Pressable>)}
    </View>
    <Text accessibilityRole="alert" style={[s.result, error && s.error, confirmed && s.success]}>
      {message}
    </Text>
    <Text style={s.hint}>Âm thử là thông báo CỤC BỘ, không phải FCM. Test push không tạo đơn.
      Đã gửi không đồng nghĩa đã nhận. Khi app chạy nền/đóng bình thường, hãy kiểm tra
      banner và âm thật; Force Stop của Android không được bảo đảm nhận push.</Text>
  </View>;
}
const s = StyleSheet.create({
 root: { gap: 8, borderTopWidth: 1, borderTopColor: "#E2E3E6", paddingTop: 12, marginTop: 10 },
 title: { color: "#252B30", fontSize: 14, fontWeight: "800" },
 line: { flexDirection: "row", minHeight: 28, alignItems: "center",
   borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#E9E9EA", gap: 10 },
 label: { width: 105, fontSize: 12, color: "#696D76" },
 value: { flex: 1, fontSize: 12, color: "#252B30" },
 actions: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
 button: { minHeight: 40, borderRadius: 9, paddingHorizontal: 10, backgroundColor: "#FFF6F6",
   borderWidth: 1, borderColor: "#E6CED0", justifyContent: "center", alignItems: "center" },
 buttonText: { fontSize: 12, fontWeight: "700", color: "#B3262D" },
 disabled: { opacity: 0.5 },
 result: { fontSize: 12, lineHeight: 18, color: "#586171" },
 error: { color: "#B91C1C" }, success: { color: "#166534", fontWeight: "700" },
 hint: { fontSize: 11, color: "#707985", lineHeight: 16 },
});
