import React from "react";
import { View, type ViewStyle } from "react-native";
import { c } from "./theme";

/** Consistent line icons drawn with React Native primitives (web and Android, no font glyphs). */
export type IconName = "dashboard" | "catalog" | "settings" | "account" | "store" |
  "clock" | "delivery" | "power" | "bell" | "users" | "plus" | "chevron" |
  "edit" | "pin" | "phone" | "check" | "close" | "orders" | "kitchen" | "banner" | "popup" | "chat";

export function Icon({ name, size = 24, color = c.ink }: {
  name: IconName; size?: number; color?: string;
}) {
  const scale = size / 24;
  const stroke = Math.max(1.6, 1.8 * scale);
  const part = (x: number, y: number, w: number, h: number, extra?: ViewStyle) =>
    <View style={{ position: "absolute", left: x * scale, top: y * scale,
      width: w * scale, height: h * scale, ...extra }} />;
  const line = (x: number, y: number, w: number, h = 0, extra?: ViewStyle) =>
    part(x, y, w, Math.max(stroke, h * scale),
      { backgroundColor: color, borderRadius: stroke, ...extra });
  const outline = (x: number, y: number, w: number, h: number, radius = 3) =>
    part(x, y, w, h, { borderWidth: stroke, borderColor: color,
      borderRadius: radius * scale });
  const dot = (x: number, y: number, d: number) =>
    part(x, y, d, d, { backgroundColor: color, borderRadius: 100 });
  let shape: React.ReactNode;
  switch (name) {
    case "dashboard": shape = <>{outline(2, 2, 8, 8, 2)}{outline(14, 2, 8, 8, 2)}
      {outline(2, 14, 8, 8, 2)}{outline(14, 14, 8, 8, 2)}</>; break;
    case "catalog": shape = <>{outline(4, 2, 16, 20, 2)}
      {line(8, 7, 8)}{line(8, 12, 8)}{line(8, 17, 5)}</>; break;
    case "settings": shape = <>{line(3, 6, 18)}{line(3, 12, 18)}{line(3, 18, 18)}
      {part(8, 3, 6, 6, { borderColor: color, backgroundColor: c.white,
        borderWidth: stroke, borderRadius: 100 })}
      {part(14, 9, 6, 6, { borderColor: color, backgroundColor: c.white,
        borderWidth: stroke, borderRadius: 100 })}
      {part(5, 15, 6, 6, { borderColor: color, backgroundColor: c.white,
        borderWidth: stroke, borderRadius: 100 })}</>; break;
    case "store": shape = <>{outline(3, 9, 18, 13, 2)}{line(2, 8, 20)}
      {line(5, 3, 14)}{line(4, 6, 16)}{outline(9, 14, 6, 8, 1)}</>; break;
    case "clock": shape = <>{outline(2, 2, 20, 20, 10)}{line(11, 6, 2, 7)}
      {part(11, 11, 7, stroke / scale, { backgroundColor: color,
        borderRadius: stroke, transform: [{ rotate: "35deg" }], transformOrigin: "left center" })}</>; break;
    case "delivery": shape = <>{outline(1, 7, 14, 10, 2)}
      {outline(15, 10, 7, 7, 2)}{line(15, 8, 3)}{dot(4, 16, 5)}
      {dot(16, 16, 5)}{line(3, 4, 11)}</>; break;
    case "power": shape = <>{part(3, 5, 18, 17,
      { borderWidth: stroke, borderColor: color, borderTopColor: "transparent",
        borderRadius: 12 * scale })}{line(11, 1, 2, 12)}</>; break;
    case "bell": shape = <>{part(4, 4, 16, 15,
      { borderWidth: stroke, borderColor: color,
        borderTopLeftRadius: 10 * scale, borderTopRightRadius: 10 * scale,
        borderBottomLeftRadius: 2 * scale, borderBottomRightRadius: 2 * scale })}
      {line(2, 18, 20)}{dot(10, 20, 4)}</>; break;
    case "account": shape = <>{outline(8, 2, 8, 8, 8)}
      {part(3, 13, 18, 9, { borderWidth: stroke, borderColor: color,
        borderBottomColor: "transparent", borderTopLeftRadius: 12 * scale,
        borderTopRightRadius: 12 * scale })}</>; break;
    case "users": shape = <>{outline(5, 2, 8, 8, 8)}
      {part(1, 13, 15, 9, { borderWidth: stroke, borderColor: color,
        borderBottomColor: "transparent", borderTopLeftRadius: 12 * scale,
        borderTopRightRadius: 12 * scale })}
      {outline(15, 5, 6, 6, 6)}
      {part(17, 14, 5, 7, { borderRightWidth: stroke, borderTopWidth: stroke,
        borderColor: color, borderTopRightRadius: 8 * scale })}</>; break;
    case "plus": shape = <>{line(4, 11, 16, 2)}
      {part(11 * scale / scale, 4, 2, 16, { backgroundColor: color, borderRadius: stroke })}</>; break;
    case "chevron": shape = <>{part(8, 7, 9, 2, { backgroundColor: color,
      transform: [{ rotate: "45deg" }], borderRadius: stroke })}
      {part(8, 15, 9, 2, { backgroundColor: color,
        transform: [{ rotate: "-45deg" }], borderRadius: stroke })}</>; break;
    case "edit": shape = <>{outline(3, 5, 16, 16, 2)}
      {part(11, 6, 12, 3, { backgroundColor: color,
        transform: [{ rotate: "-43deg" }], borderRadius: stroke })}</>; break;
    case "pin": shape = <>{part(4, 1, 16, 16, { borderWidth: stroke,
      borderColor: color, borderRadius: 12 * scale })}
      {outline(9, 6, 6, 6, 6)}
      {part(9, 15, 7, 7, { borderLeftWidth: stroke, borderBottomWidth: stroke,
        borderColor: color, transform: [{ rotate: "-45deg" }] })}</>; break;
    case "phone": shape = <>{part(6, 2, 5, 7, {
      borderLeftWidth: stroke * 1.4, borderBottomWidth: stroke * 1.4,
      borderColor: color, borderBottomLeftRadius: 4 * scale,
      transform: [{ rotate: "-32deg" }] })}
      {part(7, 8, 9, 9, {
        borderLeftWidth: stroke * 1.4, borderBottomWidth: stroke * 1.4,
        borderColor: color, borderBottomLeftRadius: 8 * scale,
        transform: [{ rotate: "-45deg" }] })}
      {part(15, 14, 5, 7, {
        borderRightWidth: stroke * 1.4, borderTopWidth: stroke * 1.4,
        borderColor: color, borderTopRightRadius: 4 * scale,
        transform: [{ rotate: "-32deg" }] })}</>; break;
    case "check": shape = <>{part(4, 13, 8, 2, { backgroundColor: color,
      transform: [{ rotate: "42deg" }], borderRadius: stroke })}
      {part(10, 10, 12, 2, { backgroundColor: color,
        transform: [{ rotate: "-43deg" }], borderRadius: stroke })}</>; break;
    case "close": shape = <>{part(4, 11, 16, 2, { backgroundColor: color,
      transform: [{ rotate: "45deg" }], borderRadius: stroke })}
      {part(4, 11, 16, 2, { backgroundColor: color,
        transform: [{ rotate: "-45deg" }], borderRadius: stroke })}</>; break;
    case "orders": shape = <>{outline(5, 2, 15, 20, 2)}{line(9, 8, 8)}
      {line(9, 13, 8)}{line(9, 18, 5)}{outline(2, 5, 5, 5, 2)}</>; break;
    case "kitchen": shape = <>{outline(2, 8, 20, 14, 2)}{line(5, 3, 2, 9)}
      {line(11, 3, 2, 9)}{line(17, 3, 2, 9)}</>; break;
    case "banner": shape = <>{outline(2, 4, 20, 16, 2)}
      {outline(5, 7, 5, 5, 5)}
      {part(5, 16, 6, 2, { backgroundColor: color, transform: [{ rotate: "-35deg" }], borderRadius: stroke })}
      {part(10, 14, 9, 2, { backgroundColor: color, transform: [{ rotate: "28deg" }], borderRadius: stroke })}</>; break;
    case "popup": shape = <>{outline(2, 3, 20, 18, 3)}{outline(6, 7, 12, 10, 2)}
      {line(8, 10, 8)}{line(8, 14, 5)}</>; break;
    case "chat": shape = <>{part(2, 3, 20, 15, { borderWidth: stroke, borderColor: color,
      borderRadius: 5 * scale })}{part(6, 16, 6, 5, { borderLeftWidth: stroke,
      borderBottomWidth: stroke, borderColor: color, transform: [{ rotate: "-18deg" }] })}
      {line(6, 8, 12)}{line(6, 12, 8)}</>; break;
  }
  return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={{ width: size, height: size, flexShrink: 0 }}>
    {shape}
  </View>;
}
