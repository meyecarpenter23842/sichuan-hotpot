import React from "react";
import { Image, View } from "react-native";

// Five individually cropped, colorful category illustrations from the
// owner-approved 01-home.png. Source sheet: 360x72, five 72px cells.
const atlas = require("../../assets/home-category-atlas.png");

export type HomeCategoryName = "hotpot" | "milkTea" | "combo" | "topping" | "offers";

const columns: Record<HomeCategoryName, number> = {
  hotpot: 0,
  milkTea: 1,
  combo: 2,
  topping: 3,
  offers: 4,
};

export function HomeCategoryIcon({ name, size = 48 }: {
  name: HomeCategoryName;
  size?: number;
}) {
  const cell = size;
  return (
    <View testID={"home-category-icon-" + name}
      accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={{ width: cell, height: cell, overflow: "hidden" }}>
      <Image source={atlas} fadeDuration={0} resizeMode="stretch"
        style={{
          position: "absolute",
          left: -columns[name] * cell,
          top: 0,
          width: cell * 5,
          height: cell,
        }}
      />
    </View>
  );
}
