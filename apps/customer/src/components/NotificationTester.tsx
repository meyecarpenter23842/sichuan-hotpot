import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { customerPushTestStatus, customerTestLocalSound, customerTestRemotePush,
  customerPushRemoteTestStatus, listenCustomerTestReceipts, type PushTestStatus } from "../push-client";

export function NotificationTester({ accessToken }: { accessToken: string }) {
  const [status, setStatus] = useState<PushTestStatus | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("Chưa chạy kiểm thử.");
  const [error, setError] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const current = useRef<string | null>(null);
  const received = useRef(new Set<string>());
  const lastPush = useRef(0);
  const [testId, setTestId] = useState<string | null>(null);
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const stop = listenCustomerTestReceipts(accessToken, id => {
      received.current.add(id);
      if (current.current === id) {
        setConfirmed(true); setError(false);
        setMessage("ĐÃ NHẬN FCM thực tế trên thiết bị khi ứng dụng mở.");
      }
    });
    void customerPushTestStatus().then(setStatus).catch(() => undefined);
    return stop;
  }, [accessToken]);
  useEffect(() => {
    if (!testId) return;
    let stopped = false;
    let checking = false;
    const deadline = Date.now() + 90_000;
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => { stopped = true; if (timer) clearInterval(timer); };
    const check = async () => {
      if (stopped || checking || AppState.currentState !== "active") return;
      if (Date.now() >= deadline) {
        setMessage("Hết thời gian theo dõi: Android chưa xác nhận đã nhận FCM. Kiểm tra khay thông báo và âm thanh.");
        stop(); return;
      }
      checking = true;
      try {
        const result = await customerPushRemoteTestStatus(accessToken, testId);
        if (stopped || current.current !== testId) return;
        if (result.status === "received_on_device" || result.received) {
          setConfirmed(true); setError(false);
          setMessage("ĐÃ NHẬN FCM trên thiết bị khi ứng dụng mở.");
          stop();
        } else if (result.status === "failed") {
          setError(true);
          setMessage("Máy chủ gửi FCM THẤT BẠI: " + (result.failureCode || "FCM_SEND_FAILED")
            + ". Kiểm tra Firebase trên VPS.");
          stop();
        } else if (result.status === "sent_to_fcm") {
          setMessage("FCM đã chấp nhận gửi; CHƯA xác nhận Android nhận. Khi app chạy nền, kiểm tra banner/chuông Android.");
        } else {
          setMessage("Đang chờ máy chủ gửi FCM sau 12 giây...");
        }
      } catch (cause) {
        if (!stopped && current.current === testId) {
          setError(true);
          setMessage("Không kiểm tra được trạng thái FCM: " +
            (cause instanceof Error ? cause.message : "Lỗi kết nối"));
        }
      } finally { checking = false; }
    };
    void check();
    timer = setInterval(() => { void check(); }, 2500);
    const resume = AppState.addEventListener("change", state => {
      if (state === "active") void check();
    });
    return () => { stop(); resume.remove(); };
  }, [testId, accessToken]);

  async function execute(mode: "status" | "sound" | "push" | "full") {
    if (busy) return;
    if ((mode === "push" || mode === "full") && Date.now() - lastPush.current < 30000) {
      setError(true); setMessage("Giới hạn: 30 giây giữa hai lần gửi FCM."); return;
    }
    setBusy(mode); setError(false); setConfirmed(false);
    if (mode === "push" || mode === "full") {
      setTestId(null);
      current.current = null;
    }
    try {
      if (mode === "status") {
        setStatus(await customerPushTestStatus());
        setMessage("Đã kiểm tra cấu hình, chưa kiểm tra việc nhận push thực tế.");
      } else if (mode === "sound") {
        await customerTestLocalSound();
        setMessage("Đã yêu cầu phát âm cục bộ bằng thông báo Android. Hãy nghe trực tiếp trên thiết bị.");
      } else {
        lastPush.current = Date.now();
        current.current = null;
        const id = await customerTestRemotePush(accessToken, mode === "full" ? 12 : 0);
        current.current = id;
        setTestId(id);
        if (received.current.has(id)) {
          setConfirmed(true); setMessage("ĐÃ NHẬN FCM thực tế trên thiết bị.");
        } else {
          setMessage(mode === "full"
            ? "Đã hẹn gửi FCM sau 12 giây. Hãy đưa app về nền hoặc đóng bình thường; CHƯA xác nhận đã nhận."
            : "FCM đã nhận yêu cầu gửi. CHƯA xác nhận thiết bị nhận. Quan sát banner/âm khi ứng dụng mở.");
        }
        setStatus(await customerPushTestStatus());
      }
    } catch (cause) {
      setError(true);
      setMessage(cause instanceof Error ? cause.message : "Không xác định được lỗi kiểm thử.");
    } finally { setBusy(""); }
  }
  if (Platform.OS !== "android") return <Text style={s.hint}>
    Chức năng test FCM và âm riêng dành cho APK Android; PWA dùng Web Push.
  </Text>;
  return <View style={s.root} testID="customer-fcm-test">
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
      Trạng thái FCM cập nhật khi app mở hoặc trở lại từ nền. FCM chấp nhận gửi
      không chứng minh Android đã phát chuông. Khi app chạy nền, hãy kiểm tra banner và âm thật.</Text>
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
