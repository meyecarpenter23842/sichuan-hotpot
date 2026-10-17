import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { apiRequest } from "./api";

async function registerNative(accessToken: string, askPermission: boolean): Promise<void> {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("customer-orders-v1", {
      name: "Cập nhật đơn hàng",
      description: "Thông báo khi cửa hàng xác nhận và cập nhật đơn",
      importance: Notifications.AndroidImportance.HIGH,
      sound: "default",
      vibrationPattern: [0, 250, 140, 250],
      enableVibrate: true,
      showBadge: true,
    });
  }
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && askPermission) permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) {
    if (askPermission) throw new Error("Chưa cấp quyền thông báo cho ứng dụng.");
    return;
  }
  if (Platform.OS !== "android") return;
  const device = await Notifications.getDevicePushTokenAsync();
  if (device.type !== "android" || typeof device.data !== "string") {
    throw new Error("Android chưa lấy được FCM device token.");
  }
  await apiRequest("/push/subscriptions", {
    method: "POST", accessToken,
    body: { scope: "CUSTOMER", transport: "FCM", token: device.data },
  });
}

export async function configureCustomerNotificationPresentation(): Promise<void> {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

export async function enableCustomerPush(accessToken: string): Promise<void> {
  await registerNative(accessToken, true);
}

export async function refreshCustomerPushIfAllowed(accessToken: string): Promise<void> {
  await registerNative(accessToken, false);
}

export async function watchCustomerNotificationResponses(
  onOpenOrder: (orderId: string) => void,
): Promise<() => void> {
  const handle = (response: Awaited<ReturnType<typeof Notifications.getLastNotificationResponseAsync>>) => {
    const data = response?.notification.request.content.data;
    if (data && typeof data.orderId === "string") onOpenOrder(data.orderId);
  };
  handle(await Notifications.getLastNotificationResponseAsync());
  const subscription = Notifications.addNotificationResponseReceivedListener(handle);
  return () => subscription.remove();
}
