import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { request } from "./api";

const ENDPOINT_KEY = "sichuan.admin.push-endpoint.v1";

type PushConfig = { enabled: boolean; publicKey: string | null };

function vapidKey(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/")
    + "=".repeat((4 - value.length % 4) % 4);
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return buffer;
}

async function registerWeb(token: string, branchId: string): Promise<string> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)
      || !("PushManager" in globalThis) || !("Notification" in globalThis)) {
    throw new Error("Trình duyệt này chưa hỗ trợ thông báo nền.");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Chưa cấp quyền thông báo cho Admin PWA.");
  const config = await request<PushConfig>("/push/config", token);
  if (!config.enabled || !config.publicKey) {
    throw new Error("Máy chủ chưa cấu hình Web Push.");
  }
  const registration = await navigator.serviceWorker.register("/hotpot-sw.js", { scope: "/" });
  const old = await registration.pushManager.getSubscription();
  if (old) await old.unsubscribe().catch(() => false);
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: vapidKey(config.publicKey),
  });
  const json = subscription.toJSON();
  if (!json.keys?.p256dh || !json.keys?.auth) {
    await subscription.unsubscribe().catch(() => false);
    throw new Error("Không lấy được khóa Web Push của thiết bị.");
  }
  await request("/push/subscriptions", token, "POST", {
    scope: "STAFF", transport: "WEB_PUSH", token: subscription.endpoint, branchId,
    p256dh: json.keys.p256dh, auth: json.keys.auth,
  });
  return subscription.endpoint;
}

async function registerNative(token: string, branchId: string): Promise<string> {
  if (Platform.OS !== "android") throw new Error("Âm báo riêng hiện chỉ dùng cho Android Admin.");
  const Notifications = await import("expo-notifications");
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

export async function enableAdminPush(token: string, branchId: string): Promise<void> {
  const endpoint = Platform.OS === "web"
    ? await registerWeb(token, branchId)
    : await registerNative(token, branchId);
  await AsyncStorage.setItem(ENDPOINT_KEY, endpoint);
}

export async function disableAdminPush(token: string): Promise<void> {
  const endpoint = await AsyncStorage.getItem(ENDPOINT_KEY);
  if (endpoint) {
    await request("/push/subscriptions/remove", token, "POST", { token: endpoint })
      .catch(() => undefined);
  }
  if (Platform.OS === "web" && typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    const registration = await navigator.serviceWorker.getRegistration("/");
    const subscription = await registration?.pushManager.getSubscription();
    await subscription?.unsubscribe().catch(() => false);
  }
  await AsyncStorage.removeItem(ENDPOINT_KEY);
}

export async function refreshAdminPushIfEnabled(
  token: string, branchId: string, enabled: boolean,
): Promise<void> {
  if (!enabled) return;
  if (Platform.OS === "web") {
    if (!("Notification" in globalThis) || Notification.permission !== "granted") return;
  } else {
    const Notifications = await import("expo-notifications");
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) return;
  }
  await enableAdminPush(token, branchId);
}

export async function watchAdminNotificationResponses(
  onOpenOrder: (orderId: string | null) => void,
): Promise<() => void> {
  if (Platform.OS === "web") return () => undefined;
  const Notifications = await import("expo-notifications");
  const handle = (response: Awaited<ReturnType<typeof Notifications.getLastNotificationResponseAsync>>) => {
    const data = response?.notification.request.content.data;
    onOpenOrder(data && typeof data.orderId === "string" ? data.orderId : null);
  };
  handle(await Notifications.getLastNotificationResponseAsync());
  const subscription = Notifications.addNotificationResponseReceivedListener(handle);
  return () => subscription.remove();
}
