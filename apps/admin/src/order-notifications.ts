import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "sichuan.admin.order.chime.v1";

export async function loadOrderChime(): Promise<boolean> {
  return (await AsyncStorage.getItem(KEY)) === "on";
}

export async function saveOrderChime(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(KEY, enabled ? "on" : "off");
}
