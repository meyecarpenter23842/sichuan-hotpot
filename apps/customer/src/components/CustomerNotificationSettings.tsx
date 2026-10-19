import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, AppState, Modal, Pressable, StyleSheet, Switch, Text, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { HotpotNavIcon } from "./HotpotNavIcon";
import { getCustomerPushSettings, setCustomerPushEnabled } from "../push-client";
import type { CustomerPushSettings } from "../push-preference";
import { palette } from "../theme";

/**
 * Customer-facing notification preferences. The FCM diagnostic tester stays
 * internal and is deliberately not mounted on any customer screen.
 */
export function CustomerNotificationSettings({ accessToken }: { accessToken: string }) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<CustomerPushSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    async function refresh() {
      try {
        const latest = await getCustomerPushSettings();
        if (alive) { setSettings(latest); setError(""); }
      } catch {
        if (alive) setError("Chưa đọc được cài đặt thông báo. Hãy thử lại.");
      } finally {
        if (alive) setLoading(false);
      }
    }
    setLoading(true);
    void refresh();
    const listener = AppState.addEventListener("change", state => {
      if (state === "active") void refresh();
    });
    return () => { alive = false; listener.remove(); };
  }, [accessToken, open]);

  const close = () => { if (!busy) setOpen(false); };
  async function changeNotifications(enabled: boolean) {
    if (busy || !accessToken) return;
    setBusy(true);
    setError("");
    try {
      await setCustomerPushEnabled(accessToken, enabled);
      setSettings(await getCustomerPushSettings());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message :
        "Không cập nhật được thông báo. Hãy thử lại.");
      // Read actual device state; never show a success after a partial failure.
      try { setSettings(await getCustomerPushSettings()); } catch { /* keep last state */ }
    } finally {
      setBusy(false);
    }
  }

  const shortStatus = loading ? "Đang kiểm tra..." :
    settings?.enabled ? "Đang bật" : settings?.available ? "Đang tắt" : "Chưa hỗ trợ";

  return <>
    <Pressable accessibilityRole="button"
      accessibilityLabel={"Cài đặt thông báo đơn hàng, " + shortStatus}
      onPress={() => setOpen(true)}
      style={({ pressed }) => [s.entry, pressed && s.pressed]}>
      <View style={s.iconCircle}><HotpotNavIcon name="notifications" size={20} /></View>
      <View style={s.entryCopy}>
        <Text style={s.entryTitle}>Thông báo đơn hàng</Text>
        <Text style={s.entryStatus}>{shortStatus}</Text>
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
          <View style={s.settingRow}>
            <View style={s.settingCopy}>
              <Text style={s.settingTitle}>Nhận thông báo</Text>
              <Text style={s.settingStatus}>{settings?.detail ?? "Đang kiểm tra..."}</Text>
            </View>
            {loading ? <ActivityIndicator color={palette.red} /> :
              <Switch accessibilityLabel="Bật hoặc tắt thông báo đơn hàng"
                accessibilityRole="switch"
                value={!!settings?.enabled}
                disabled={busy || !settings?.available}
                onValueChange={value => void changeNotifications(value)}
                trackColor={{ false: "#D0D5DD", true: "#E9A1A5" }}
                thumbColor={settings?.enabled ? palette.red : "#FFFFFF"} />}
          </View>
          <Text style={s.description}>
            Chỉ thông báo khi quán xác nhận hoặc hủy đơn, và khi đơn bắt đầu giao.
          </Text>
          {!!error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}
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
  settingRow: { minHeight: 72, flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", gap: 12,
    borderBottomWidth: 1, borderBottomColor: "#EEF0F3" },
  settingCopy: { flex: 1, minWidth: 0, gap: 5 },
  settingTitle: { color: palette.text, fontSize: 14, fontWeight: "700" },
  settingStatus: { color: palette.muted, fontSize: 12, lineHeight: 18 },
  description: { color: palette.muted, fontSize: 13, lineHeight: 20 },
  error: { color: palette.red, fontSize: 13, lineHeight: 19 },
});
