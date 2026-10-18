import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiRequest } from "./api";

type NotificationsModule = typeof import("expo-notifications");

let notificationsModule: Promise<NotificationsModule | null> | null = null;
const ENDPOINT_KEY = "sichuan.customer.push-endpoint.v1";

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

async function registerNative(accessToken: string, askPermission: boolean): Promise<string | null> {
  const Notifications = await loadNotifications(askPermission);
  if (!Notifications) return null;

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
    return null;
  }
  if (Platform.OS !== "android") return null;
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
  await AsyncStorage.setItem(ENDPOINT_KEY, device.data);
  return device.data;
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

export type PushTestStatus = { permission: string; firebase: string; token: string; sound: string };
export async function customerPushTestStatus(): Promise<PushTestStatus> {
  const Notifications = await loadNotifications(true);
  if (!Notifications) throw new Error("Expo Notifications chưa sẵn sàng.");
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return { permission: permission.canAskAgain ? "Chưa cấp" : "Bị từ chối",
    firebase: "Chưa xác minh", token: "Chưa đăng ký", sound: "default (chưa thử nghe)" };
  try {
    const device = await Notifications.getDevicePushTokenAsync();
    return { permission: "Đã cấp", firebase: "Khởi tạo Firebase và lấy token thành công",
      token: device.type === "android" && typeof device.data === "string" ? "Sẵn sàng" : "Không hợp lệ",
      sound: "default (chưa thử nghe)" };
  } catch (error) {
    return { permission: "Đã cấp", firebase: error instanceof Error ? error.message : "Không truy cập được Firebase",
      token: "Không khả dụng", sound: "default (chưa thử nghe)" };
  }
}
export async function customerTestLocalSound(): Promise<void> {
  const Notifications = await loadNotifications(true);
  if (!Notifications) throw new Error("Expo Notifications chưa sẵn sàng.");
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) throw new Error("Phải cấp quyền thông báo để kiểm tra âm thanh hệ thống Android.");
  await Notifications.setNotificationChannelAsync("customer-orders-v1", {
    name: "Cập nhật đơn hàng",
    importance: Notifications.AndroidImportance.HIGH,
    sound: "default",
  });
  await Notifications.scheduleNotificationAsync({
    content: { title: "Kiểm tra âm thanh", body: "Âm thử cục bộ, không tạo đơn hàng.",
      sound: "default", data: { kind: "LOCAL_SOUND_TEST" } },
    trigger: null,
  });
}
export async function customerTestRemotePush(accessToken: string): Promise<string> {
  const deviceToken = await registerNative(accessToken, true);
  if (!deviceToken) throw new Error("Thiết bị chưa có FCM token.");
  await AsyncStorage.setItem(ENDPOINT_KEY, deviceToken);
  const result = await apiRequest<{ testId: string }>("/push/test", { method: "POST", accessToken, body: { token: deviceToken } });
  return result.testId;
}
export function listenCustomerTestReceipts(
  accessToken: string, onReceipt: (testId: string) => void,
): () => void {
  let listener: { remove: () => void } | undefined;
  let active = true;
  void loadNotifications(false).then(Notifications => {
    if (!active || !Notifications) return;
    listener = Notifications.addNotificationReceivedListener(notification => {
    const data = notification.request.content.data;
    if (data?.kind !== "TEST" || typeof data.testId !== "string") return;
    void AsyncStorage.getItem(ENDPOINT_KEY).then(endpoint => {
      if (!endpoint) return;
      return apiRequest("/push/test/receipt", { method: "POST", accessToken, body: { testId: data.testId, token: endpoint } }).then(() => onReceipt(data.testId as string));
    }).catch(() => undefined);
  });
  }).catch(() => undefined);
  return () => { active = false; listener?.remove(); };
}

export async function disableCustomerPush(accessToken: string): Promise<void> {
  const token = await AsyncStorage.getItem(ENDPOINT_KEY);
  if (!token) return;
  await apiRequest("/push/subscriptions/remove", { method: "POST", accessToken, body: { token } });
  await AsyncStorage.removeItem(ENDPOINT_KEY);
}
