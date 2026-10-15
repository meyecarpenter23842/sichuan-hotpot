import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

/**
 * Single semantic switch for Android & Web/PWA. Native Switch plus a web
 * wrapper creates duplicate role=switch nodes, so expose ONE Pressable.
 * Server data remains authoritative; caller locks pending writes/reloads.
 */
export function StatusSwitch({ value, onValueChange, label, hint, disabled = false, busy = false }: {
  value: boolean;
  onValueChange: (value: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
  busy?: boolean;
}) {
  const locked = disabled || busy;
  return <Pressable
    accessibilityRole="switch"
    accessibilityLabel={label}
    accessibilityHint={hint ?? (value ? "Đang bật" : "Đang tắt")}
    accessibilityState={{ checked: value, disabled: locked, busy }}
    aria-checked={value}
    disabled={locked}
    onPress={() => { if (!locked) onValueChange(!value); }}
    style={({ pressed }) => [st.touch, pressed && !locked && st.pressed,
      locked && st.disabled]}
  >
    <View pointerEvents="none" style={[st.track, value && st.on]}>
      <View style={[st.thumb, value && st.thumbOn]} />
    </View>
    {busy && <View pointerEvents="none" style={st.loader}>
      <ActivityIndicator size="small" color="#B3262D" />
    </View>}
  </Pressable>;
}
const st = StyleSheet.create({
  touch: { minHeight: 44, minWidth: 56, alignItems: "center",
    justifyContent: "center", borderRadius: 24 },
  track: { width: 52, height: 30, padding: 3, borderRadius: 20,
    backgroundColor: "#B7B8BC", justifyContent: "center" },
  on: { backgroundColor: "#FA850F" },
  thumb: { width: 24, height: 24, backgroundColor: "#FFFFFF", borderRadius: 12,
    shadowColor: "#000000", shadowOpacity: 0.13, shadowRadius: 2, elevation: 2 },
  thumbOn: { transform: [{ translateX: 22 }] },
  loader: { position: "absolute", right: 2, top: 7, backgroundColor: "#FFFFFF",
    borderRadius: 15, padding: 2 },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.55 },
});
