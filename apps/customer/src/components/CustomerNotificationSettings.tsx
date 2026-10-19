import React, { useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { HotpotNavIcon } from "./HotpotNavIcon";
import { enableCustomerPush } from "../push-client";
import { palette } from "../theme";

/**
 * Presentation only: reuse the existing notification registration action.
 * Keep Firebase/FCM diagnostics out of the customer-facing account screen.
 */
export function CustomerNotificationSettings({ accessToken }: { accessToken: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);

  const close = () => { if (!busy) setOpen(false); };

  async function requestNotifications() {
    if (!accessToken || busy) return;
    setBusy(true);
    setMessage("");
    setError(false);
    try {
      // Same function used by the old home bell; no push lifecycle changes.
      await enableCustomerPush(accessToken);
      setMessage("Đã bật thông báo đơn hàng trên thiết bị này.");
    } catch (cause) {
      setError(true);
      setMessage(cause instanceof Error ? cause.message :
        "Không bật được thông báo. Anh/chị vui lòng thử lại.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <Pressable accessibilityRole="button" accessibilityLabel="Cài đặt thông báo đơn hàng"
      onPress={() => { setMessage(""); setError(false); setOpen(true); }}
      style={({ pressed }) => [s.entry, pressed && s.pressed]}>
      <View style={s.iconCircle}><HotpotNavIcon name="notifications" size={20} /></View>
      <View style={s.entryCopy}>
        <Text style={s.entryTitle}>Thông báo đơn hàng</Text>
        <Text style={s.entryStatus}>Quán xác nhận, hủy đơn và bắt đầu giao</Text>
      </View>
      <Text style={s.chevron}>›</Text>
    </Pressable>
    <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
      <View style={s.backdrop}>
        <Pressable accessibilityRole="button" accessibilityLabel="Đóng cài đặt thông báo"
          style={StyleSheet.absoluteFill} onPress={close} />
        <SafeAreaView edges={["bottom"]} style={s.sheet}>
          <View style={s.heading}>
            <Text style={s.title}>Thông báo đơn hàng</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Đóng"
              disabled={busy} onPress={close} style={s.close}>
              <Text style={s.closeText}>✕</Text>
            </Pressable>
          </View>
          <Text style={s.description}>
            Nhận thông báo khi quán xác nhận hoặc hủy đơn, và khi đơn bắt đầu giao.
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Bật thông báo đơn hàng"
            accessibilityState={{ disabled: busy }} disabled={busy}
            onPress={() => void requestNotifications()} style={[s.action, busy && s.disabled]}>
            {busy ? <ActivityIndicator color={palette.white} /> :
              <Text style={s.actionText}>Bật thông báo</Text>}
          </Pressable>
          {!!message && <Text accessibilityRole="alert"
            style={[s.feedback, error && s.error]}>{message}</Text>}
          <Text style={s.note}>Để tắt thông báo, anh/chị có thể đổi quyền trong cài đặt điện thoại.</Text>
        </SafeAreaView>
      </View>
    </Modal>
  </>;
}

const s = StyleSheet.create({
  entry: { flexDirection: "row", alignItems: "center", minHeight: 70,
    borderBottomWidth: 1, borderBottomColor: "#EEF0F3", paddingHorizontal: 8 },
  pressed: { opacity: 0.72 },
  iconCircle: { width: 40, height: 40, marginRight: 9, borderRadius: 22,
    backgroundColor: "#F5F6F8", justifyContent: "center", alignItems: "center" },
  entryCopy: { flex: 1, minWidth: 0, paddingVertical: 11, gap: 4 },
  entryTitle: { color: palette.text, fontSize: 14, fontWeight: "700" },
  entryStatus: { color: palette.muted, fontSize: 12 },
  chevron: { color: "#9AA1AC", fontSize: 22, paddingRight: 4 },
  backdrop: { flex: 1, backgroundColor: "rgba(17,24,39,0.48)",
    justifyContent: "center", alignItems: "center", paddingHorizontal: 18 },
  sheet: { width: "100%", maxWidth: 420, backgroundColor: palette.white,
    borderRadius: 18, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 12, gap: 14 },
  heading: { flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", gap: 10 },
  title: { flex: 1, fontSize: 17, fontWeight: "800", color: palette.text },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  closeText: { color: palette.muted, fontSize: 21, fontWeight: "600" },
  description: { color: palette.muted, fontSize: 13, lineHeight: 20 },
  action: { minHeight: 48, borderRadius: 12, backgroundColor: palette.red,
    alignItems: "center", justifyContent: "center", paddingVertical: 12 },
  actionText: { color: palette.white, fontSize: 14, fontWeight: "800" },
  disabled: { opacity: 0.55 },
  feedback: { color: "#167442", fontSize: 13, lineHeight: 19 },
  error: { color: palette.red },
  note: { color: palette.muted, fontSize: 12, lineHeight: 18 },
});
