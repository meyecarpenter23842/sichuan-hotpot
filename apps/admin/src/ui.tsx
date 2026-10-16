import React from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { c, font } from "./theme";

export function Action({ label, onPress, secondary = false, dangerous = false, disabled = false }: {
  label: string; onPress: () => void; secondary?: boolean; dangerous?: boolean; disabled?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [s.action,
      secondary && s.actionSecondary, dangerous && s.actionDanger,
      disabled && s.disabled, pressed && !disabled && s.pressed]}>
    <Text style={[s.actionLabel, (secondary || dangerous) && s.actionLabelSecondary,
      dangerous && s.actionLabelDanger]} numberOfLines={1}>{label}</Text>
  </Pressable>;
}
export function Field({ label, value, onChangeText, placeholder, numeric = false,
  secure = false, multiline = false, decimal = false, maxLength, helper }: {
  label: string; value: string; onChangeText: (value: string) => void;
  placeholder?: string; numeric?: boolean; secure?: boolean; multiline?: boolean; decimal?: boolean;
  maxLength?: number; helper?: string;
}) {
  return <View style={s.field}>
    <Text style={s.fieldLabel}>{label}</Text>
    <TextInput style={[s.input, multiline && s.multiline]} accessibilityLabel={label}
      value={value} placeholder={placeholder} placeholderTextColor="#98A2B3"
      onChangeText={onChangeText} keyboardType={decimal ? "decimal-pad" : numeric ? "number-pad" : "default"}
      secureTextEntry={secure} autoCapitalize="none" maxLength={maxLength}
      multiline={multiline} />
    {!!helper && <Text style={s.fieldHelper}>{helper}</Text>}
  </View>;
}
export function Pill({ label, active = false, onPress }: {
  label: string; active?: boolean; onPress: () => void;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ selected: active }} onPress={onPress}
    style={[s.pill, active && s.pillActive]}>
    <Text style={[s.pillText, active && s.pillTextActive]}>{label}</Text>
  </Pressable>;
}
export function Notice({ text, error = false }: { text: string; error?: boolean }) {
  return <View style={[s.notice, error && s.noticeError]}>
    <Text style={s.noticeText}>{text}</Text>
  </View>;
}
export const s = StyleSheet.create({
  action: { minHeight: 44, paddingHorizontal: 14, alignItems: "center",
    justifyContent: "center", backgroundColor: c.red, borderRadius: 10 },
  actionSecondary: { backgroundColor: c.white, borderWidth: 1, borderColor: c.line },
  actionDanger: { backgroundColor: c.soft, borderWidth: 1, borderColor: "#EEC9CB" },
  actionLabel: { fontSize: font.action, color: c.white, fontWeight: "700" },
  actionLabelSecondary: { color: c.ink }, actionLabelDanger: { color: c.red },
  disabled: { opacity: 0.45 }, pressed: { opacity: 0.78 },
  field: { gap: 5 }, fieldLabel: { fontSize: font.note, color: c.ink, fontWeight: "700" },
  fieldHelper: { fontSize: 11, lineHeight: 16, color: c.secondary },
  input: { minHeight: 44, borderWidth: 1, borderColor: "#D6DBE1",
    borderRadius: 9, paddingHorizontal: 12, paddingVertical: 7, color: c.ink,
    backgroundColor: c.white, fontSize: 16 },
  multiline: { minHeight: 70, textAlignVertical: "top" },
  pill: { paddingHorizontal: 12, minHeight: 35, justifyContent: "center",
    borderRadius: 18, borderWidth: 1, borderColor: c.line, backgroundColor: c.white },
  pillActive: { borderColor: c.red, backgroundColor: c.soft },
  pillText: { fontSize: font.note, fontWeight: "600", color: c.secondary },
  pillTextActive: { color: c.red },
  notice: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 9,
    backgroundColor: c.pale, borderWidth: 1, borderColor: c.line },
  noticeError: { backgroundColor: "#FFF0F0", borderColor: "#F4C8CC" },
  noticeText: { fontSize: font.note, lineHeight: 18, color: c.ink },
});
