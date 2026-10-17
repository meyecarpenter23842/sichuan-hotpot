import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import React from "react";
import { View } from "react-native";

const glyphs = {
  home: ["home-variant-outline", "home-variant"],
  search: ["magnify", "magnify"],
  menu: ["silverware-fork-knife", "silverware-fork-knife"],
  categories: ["shape-outline", "shape"],
  hotpot: ["pot-steam-outline", "pot-steam"],
  chili: ["chili-mild-outline", "chili-mild"],
  cart: ["cart-outline", "cart"],
  orders: ["receipt-text-outline", "receipt-text"],
  favorites: ["heart-outline", "heart"],
  notifications: ["bell-outline", "bell"],
  user: ["account-outline", "account"],
  settings: ["cog-outline", "cog"],
} as const;

export type HotpotNavIconName = keyof typeof glyphs;

/** Crisp vector icons for navigation/actions; never crop icons from bitmap reference sheets. */
export function HotpotNavIcon({ name, active = false, size = 24 }: {
  name: HotpotNavIconName;
  active?: boolean;
  size?: number;
}) {
  const glyph = glyphs[name][active ? 1 : 0];
  return (
    <View
      testID={"icon-" + name + (active ? "-active" : "")}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}
    >
      <MaterialCommunityIcons
        name={glyph as never}
        size={size}
        color={active ? "#B3262D" : "#667085"}
      />
    </View>
  );
}
