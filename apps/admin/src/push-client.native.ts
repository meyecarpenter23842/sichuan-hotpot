import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { request } from "./api";

const ENDPOINT_KEY = "sichuan.admin.push-endpoint.v1";

async function registerNative(token: string, branchId: string): Promise<string> {
  await Notifications.setNotificationChannelAsync("new-orders-v1", {
    name: "Đơn hàng mới",
    description: "Đơn mới cần quản trị xác nhận",
    importance: Notifications.AndroidImportance.MAX,
    sound: "new_order_alert.mp3",
    vibrationPattern: [0, 450, 180, 450],
    enableVibrate: true,
    showBadge: true,
  });
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) throw new Error("Chưa cấp quyền thông báo cho ứng dụng Admin.");
  const device = await Notifications.getDevicePushTokenAsync();
  if (device.type !== "android" || typeof device.data !== "string") {
    throw new Error("Android chưa lấy được FCM device token.");
  }
  await request("/push/subscriptions", token, "POST", {
    scope: "STAFF", transport: "FCM", token: device.data, branchId,
  });
  return device.data;
}

export async function configureAdminNotificationPresentation(): Promise<void> {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

export async function enableAdminPush(token: string, branchId: string): Promise<void> {
  const endpoint = await registerNative(token, branchId);
  await AsyncStorage.setItem(ENDPOINT_KEY, endpoint);
}

export async function disableAdminPush(token: string): Promise<void> {
  const endpoint = await AsyncStorage.getItem(ENDPOINT_KEY);
  if (endpoint) {
    await request("/push/subscriptions/remove", token, "POST", { token: endpoint })
      .catch(() => undefined);
  }
  await AsyncStorage.removeItem(ENDPOINT_KEY);
}

export async function refreshAdminPushIfEnabled(
  token: string, branchId: string, enabled: boolean,
): Promise<void> {
  if (!enabled) return;
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;
  await enableAdminPush(token, branchId);
}

export async function watchAdminNotificationResponses(
  onOpenOrder: (orderId: string | null) => void,
): Promise<() => void> {
  const handle = (response: Awaited<ReturnType<typeof Notifications.getLastNotificationResponseAsync>>) => {
    const data = response?.notification.request.content.data;
    onOpenOrder(data && typeof data.orderId === "string" ? data.orderId : null);
  };
  handle(await Notifications.getLastNotificationResponseAsync());
  const subscription = Notifications.addNotificationResponseReceivedListener(handle);
  return () => subscription.remove();
}
