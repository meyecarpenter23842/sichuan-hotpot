import React, { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { embeddedAdminRelease, requestAdminRelease } from "./pwa-release";

/**
 * A running iPhone PWA cannot safely hot-swap its React code. Detect the
 * deployment on focus/resume and offer an explicit reload AFTER the owner
 * finishes saving an order or editing a form. Never discard unsaved work.
 */
export function AdminPwaReleaseNotice(): React.ReactElement | null {
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const current = embeddedAdminRelease(document);
    if (!current) return; // Expo dev, Android and unversioned previews.
    let alive = true;
    let busy = false;
    let controller: AbortController | null = null;

    const check = async () => {
      if (!alive || busy || document.visibilityState === "hidden") return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      busy = true;
      controller = new AbortController();
      const pending = controller;
      const timeout = window.setTimeout(() => pending.abort(), 8000);
      try {
        const latest = await requestAdminRelease(window.fetch.bind(window), pending.signal);
        if (alive && latest && latest !== current) setUpdateReady(true);
      } catch {
        // Offline/timeout is not a new release. Retry on resume or next poll.
      } finally {
        window.clearTimeout(timeout);
        if (controller === pending) controller = null;
        busy = false;
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    const onPageShow = () => { void check(); };
    void check();
    const interval = window.setInterval(() => { void check(); }, 120000);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onPageShow);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("online", onPageShow);
    return () => {
      alive = false;
      controller?.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onPageShow);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("online", onPageShow);
    };
  }, []);

  if (Platform.OS !== "web" || !updateReady) return null;
  return <View style={styles.notice} accessibilityLiveRegion="polite">
    <View style={styles.copy}>
      <Text style={styles.title}>Đã có phiên bản Admin mới</Text>
      <Text style={styles.subtitle}>Lưu xong thao tác đang làm rồi cập nhật.</Text>
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel="Cập nhật giao diện Admin"
      onPress={() => window.location.reload()} style={styles.button}>
      <Text style={styles.buttonText}>Cập nhật</Text>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  notice: {
    position: "absolute", left: 12, right: 12, bottom: 87, zIndex: 60,
    backgroundColor: "#FFFBF3", borderRadius: 12, borderWidth: 1,
    borderColor: "#E6CFA8", minHeight: 68, paddingVertical: 9,
    paddingHorizontal: 12, flexDirection: "row", alignItems: "center",
    gap: 10, shadowColor: "#2B1410", shadowOpacity: 0.17,
    shadowRadius: 9, shadowOffset: { width: 0, height: 3 }, elevation: 8,
  },
  copy: { flex: 1, gap: 3, minWidth: 0 },
  title: { fontWeight: "800", fontSize: 13, color: "#60241C" },
  subtitle: { fontSize: 11, color: "#625752" },
  button: {
    minHeight: 44, minWidth: 78, borderRadius: 9,
    backgroundColor: "#AA1824", alignItems: "center",
    justifyContent: "center", paddingHorizontal: 10,
  },
  buttonText: { fontWeight: "800", fontSize: 12, color: "#FFF" },
});
