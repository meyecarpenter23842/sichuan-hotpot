import { Platform } from "react-native";
import { apiRequest } from "./api";

type PushConfig = { enabled: boolean; publicKey: string | null };

function vapidKey(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/")
    + "=".repeat((4 - value.length % 4) % 4);
  const raw = atob(base64);
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}

async function registerWeb(accessToken: string, askPermission: boolean): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)
      || !("PushManager" in globalThis) || !("Notification" in globalThis)) {
    throw new Error("Trình duyệt này chưa hỗ trợ thông báo nền.");
  }
  if (askPermission && Notification.permission === "default") {
    await Notification.requestPermission();
  }
  if (Notification.permission !== "granted") {
    if (askPermission) throw new Error("Chưa cấp quyền thông báo cho ứng dụng.");
    return;
  }
  const config = await apiRequest<PushConfig>("/push/config", { accessToken });
  if (!config.enabled || !config.publicKey) {
    if (askPermission) throw new Error("Máy chủ chưa cấu hình Web Push.");
    return;
  }
  const registration = await navigator.serviceWorker.register("/hotpot-sw.js", { scope: "/" });
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: vapidKey(config.publicKey),
    });
  }
  const json = subscription.toJSON();
  if (!json.keys?.p256dh || !json.keys?.auth) {
    throw new Error("Không lấy được khóa Web Push của thiết bị.");
  }
  await apiRequest("/push/subscriptions", {
    method: "POST", accessToken,
    body: {
      scope: "CUSTOMER", transport: "WEB_PUSH", token: subscription.endpoint,
      p256dh: json.keys.p256dh, auth: json.keys.auth,
    },
  });
}

async function registerNative(accessToken: string, askPermission: boolean): Promise<void> {
  const Notifications = await import("expo-notifications");
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
  if (Platform.OS === "web") return;
  const Notifications = await import("expo-notifications");
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
  if (Platform.OS === "web") await registerWeb(accessToken, true);
  else await registerNative(accessToken, true);
}

export async function refreshCustomerPushIfAllowed(accessToken: string): Promise<void> {
  if (Platform.OS === "web") await registerWeb(accessToken, false);
  else await registerNative(accessToken, false);
}

export async function watchCustomerNotificationResponses(
  onOpenOrder: (orderId: string) => void,
): Promise<() => void> {
  if (Platform.OS === "web") return () => undefined;
  const Notifications = await import("expo-notifications");
  const handle = (response: Awaited<ReturnType<typeof Notifications.getLastNotificationResponseAsync>>) => {
    const data = response?.notification.request.content.data;
    if (data && typeof data.orderId === "string") onOpenOrder(data.orderId);
  };
  handle(await Notifications.getLastNotificationResponseAsync());
  const subscription = Notifications.addNotificationResponseReceivedListener(handle);
  return () => subscription.remove();
}
