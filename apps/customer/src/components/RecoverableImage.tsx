import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Image, Platform, Pressable, StyleSheet,
  Text, View, type ImageResizeMode, type StyleProp, type ViewStyle } from "react-native";

/** Retries transient native image/CDN failures without changing the original URL. */
export function RecoverableImage({ uri, style, resizeMode = "cover", accessibilityLabel,
  compact = false }: {
  uri: string; style: StyleProp<ViewStyle>; resizeMode?: ImageResizeMode;
  accessibilityLabel: string; compact?: boolean;
}) {
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const currentPhase = useRef(phase);
  currentPhase.current = phase;
  const retry = useCallback(() => { setPhase("loading"); setAttempt(n => n + 1); }, []);
  useEffect(() => { setAttempt(0); setPhase("loading"); }, [uri]);
  useEffect(() => {
    if (Platform.OS !== "android") return;
    let previous = AppState.currentState;
    const listener = AppState.addEventListener("change", next => {
      if (next === "active" && previous !== "active" && currentPhase.current === "error") retry();
      previous = next;
    });
    return () => listener.remove();
  }, [retry]);
  return <View style={[style, styles.frame]}>
    <Image key={uri + ":" + attempt} source={{uri, cache: attempt ? "reload" : "default"}}
      style={StyleSheet.absoluteFillObject} resizeMode={resizeMode}
      accessibilityLabel={accessibilityLabel} onLoad={() => setPhase("ready")}
      onError={() => setPhase("error")} />
    {phase === "loading" && !compact && <View pointerEvents="none" style={styles.overlay}>
      <ActivityIndicator size="small" color="#B3262D" accessibilityLabel="Đang tải ảnh" />
    </View>}
    {phase === "error" && <View style={[styles.overlay, compact && styles.compactOverlay]}>
      {!compact && <Text style={styles.caption}>Ảnh chưa tải được</Text>}
      <Pressable accessibilityRole="button" accessibilityLabel={"Tải lại " + accessibilityLabel}
        onPress={retry} style={[styles.button, compact && styles.compactButton]}>
        <Text style={styles.buttonText}>{compact ? "↻" : "Thử lại"}</Text>
      </Pressable>
    </View>}
  </View>;
}
const styles = StyleSheet.create({
  frame: { overflow: "hidden" },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: "center",
    justifyContent: "center", gap: 4, backgroundColor: "rgba(255,248,243,.94)" },
  compactOverlay: { backgroundColor: "#FFF2EE" },
  caption: { color: "#8C292B", fontWeight: "600", fontSize: 11, textAlign: "center" },
  button: { minHeight: 44, minWidth: 64, paddingHorizontal: 9, borderRadius: 9,
    justifyContent: "center", alignItems: "center", backgroundColor: "#B3262D" },
  compactButton: { minHeight: 24, minWidth: 24, borderRadius: 5, paddingHorizontal: 0 },
  buttonText: { color: "#FFFFFF", fontWeight: "800", fontSize: 12 },
});
