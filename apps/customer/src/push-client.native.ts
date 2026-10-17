import { Platform } from "react-native";
import { apiRequest } from "./api";

type NotificationsModule = typeof import("expo-notifications");

let notificationsModule: Promise<NotificationsModule | null> | null = null;

async function loadNotifications(required: boolean): Promise<NotificationsModule | null> {
  if (!notificationsModule) {
    notificationsModule = import("expo-notifications").catch(() => null);
  }
  const Notifications = await notificationsModule;
  if (!Notifications && required) {
    throw new Error(
      "Bản Android hiện tại chưa tích hợp module thông báo. Hãy rebuild ứng dụng Android rồi thử lại.",
    );
  }
  return Notifications;
}

async function registerNative(accessToken: string, askPermission: boolean): Promise<void> {
  const Notifications = await loadNotifications(askPermission);
  if (!Notifications) return;

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
  let device: Awaited<ReturnType<NotificationsModule["getDevicePushTokenAsync"]>>;
  try {
    device = await Notifications.getDevicePushTokenAsync();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error ?? "");
    if (/firebase|google-services|fcm|messaging/i.test(detail)) {
      throw new Error(
        "Bản Android này chưa có cấu hình Firebase Push. Cần đặt apps/customer/google-services.json đúng package vn.sichuanhotpot.customer rồi rebuild ứng dụng.",
      );
    }
    throw new Error("Android chưa đăng ký được push notification. Vui lòng thử lại sau.");
  }
  if (device.type !== "android" || typeof device.data !== "string") {
    throw new Error("Android chưa lấy được FCM device token.");
  }
  await apiRequest("/push/subscriptions", {
    method: "POST", accessToken,
    body: { scope: "CUSTOMER", transport: "FCM", token: device.data },
  });
}

export async function configureCustomerNotificationPresentation(): Promise<void> {
  const Notifications = await loadNotifications(false);
  if (!Notifications) return;

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
  const Notifications = await loadNotifications(false);
  if (!Notifications) return () => undefined;

  const handle = (
    response: Awaited<ReturnType<NotificationsModule["getLastNotificationResponseAsync"]>>,
  ) => {
    const data = response?.notification.request.content.data;
    if (data && typeof data.orderId === "string") onOpenOrder(data.orderId);
  };
  handle(await Notifications.getLastNotificationResponseAsync());
  const subscription = Notifications.addNotificationResponseReceivedListener(handle);
  return () => subscription.remove();
}
