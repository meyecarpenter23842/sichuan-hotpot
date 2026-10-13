import React from "react";
import { Image, StyleSheet, View } from "react-native";

// Cropped directly from the owner-provided Sichuan Hotpot icon sheet.
// One 336x56 transparent atlas, 12 columns x 2 states. No emoji or font-icon substitution.
const navigationSheet = require("../../assets/sheet-navigation.png");
const columns = {
  home: 0, search: 1, menu: 2, categories: 3, hotpot: 4, chili: 5,
  cart: 6, orders: 7, favorites: 8, notifications: 9, user: 10, settings: 11,
} as const;

export type HotpotNavIconName = keyof typeof columns;

export function HotpotNavIcon({ name, active = false, size = 24 }: {
  name: HotpotNavIconName;
  active?: boolean;
  size?: number;
}) {
  const col = columns[name];
  const sheetScale = size / 28;
  return (
    <View testID={"icon-" + name + (active ? "-active" : "")}
      accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={[styles.clip, { width: size, height: size }]}>
      <Image source={navigationSheet} resizeMode="stretch" fadeDuration={0}
        style={{ position: "absolute", left: -col * size, top: active ? -size : 0,
          width: 336 * sheetScale, height: 56 * sheetScale }} />
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: "hidden", flexShrink: 0 },
});
