import React from "react";
import { ActivityIndicator, StyleSheet, Switch, View } from "react-native";

/**
 * Scoped first consumer for #94. Use real API values; never advance the visual
 * state until the server has accepted the change and AdminCatalog has reloaded.
 * UI touch target is 56×44; native/web Switch retains screen reader support.
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
  return <View style={st.target}>
    <Switch
      value={value}
      onValueChange={next => { if (!locked && next !== value) onValueChange(next); }}
      disabled={locked}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={hint ?? (value ? "Đang bật" : "Đang tắt")}
      accessibilityState={{ checked: value, disabled: locked, busy }}
      trackColor={{ false: "#B7B8BC", true: "#FA850F" }}
      thumbColor="#FFFFFF"
      ios_backgroundColor="#B7B8BC"
    />
    {busy && <View pointerEvents="none" style={st.loader}>
      <ActivityIndicator size="small" color="#B3262D" />
    </View>}
  </View>;
}
const st = StyleSheet.create({
  target: { minHeight: 44, minWidth: 56, alignItems: "center", justifyContent: "center" },
  loader: { position: "absolute", top: 8, right: 3, borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.85)", padding: 3 },
});
