import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { adminTestLocalSound } from "./push-client.native";

export async function playDiningAlert(test = false): Promise<void> {
  if (Platform.OS !== "android") return;
  if (test) { await adminTestLocalSound(); return; }
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;
  await Notifications.scheduleNotificationAsync({
    content: { title: "Có yêu cầu QR tại bàn",
      body: "Mở tab Bàn để duyệt món trước khi chuyển bếp.",
      sound: "new_order_alert.mp3", data: { kind: "DINING_PENDING" } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 1, channelId: "new-orders-v3" },
  });
}
