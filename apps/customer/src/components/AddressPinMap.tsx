import React from "react";
import { Text, View } from "react-native";
import type { AddressPinProps } from "./address-pin-types";

/** Platform-neutral fallback for targets without web/native interactive maps. */
export function AddressPinMap(_props: AddressPinProps) {
  return (
    <View style={{ padding: 12 }}>
      <Text>Không hỗ trợ bản đồ trên thiết bị này. Nhập tọa độ bên dưới để chọn vị trí.</Text>
    </View>
  );
}
