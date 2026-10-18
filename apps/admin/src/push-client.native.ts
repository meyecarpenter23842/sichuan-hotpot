import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { request } from "./api";
import { Platform } from "react-native";

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
  if (Platform.OS !== "android") throw new Error("FCM chỉ hỗ trợ ứng dụng Android.");
  let device: Awaited<ReturnType<typeof Notifications.getDevicePushTokenAsync>>;
  try { device = await Notifications.getDevicePushTokenAsync(); }
  catch (error) { throw new Error("Firebase Android chưa khởi tạo: " +
    (error instanceof Error ? error.message : "không lấy được token") + ". Kiểm tra google-services.json rồi rebuild APK."); }
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
    if (!data || data.kind === "TEST" || typeof data.orderId !== "string" || !data.orderId) return;
    onOpenOrder(data.orderId);
  };
  handle(await Notifications.getLastNotificationResponseAsync());
  const subscription = Notifications.addNotificationResponseReceivedListener(handle);
  return () => subscription.remove();
}

export type PushTestStatus = { permission: string; firebase: string; token: string; sound: string };
export async function adminPushTestStatus(): Promise<PushTestStatus> {
  if (!Notifications) throw new Error("Expo Notifications chưa sẵn sàng.");
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return { permission: permission.canAskAgain ? "Chưa cấp" : "Bị từ chối",
    firebase: "Chưa xác minh", token: "Chưa đăng ký", sound: "new_order_alert.mp3 (chưa thử nghe)" };
  try {
    const device = await Notifications.getDevicePushTokenAsync();
    return { permission: "Đã cấp", firebase: "Khởi tạo Firebase và lấy token thành công",
      token: device.type === "android" && typeof device.data === "string" ? "Sẵn sàng" : "Không hợp lệ",
      sound: "new_order_alert.mp3 (chưa thử nghe)" };
  } catch (error) {
    return { permission: "Đã cấp", firebase: error instanceof Error ? error.message : "Không truy cập được Firebase",
      token: "Không khả dụng", sound: "new_order_alert.mp3 (chưa thử nghe)" };
  }
}
export async function adminTestLocalSound(): Promise<void> {
  if (!Notifications) throw new Error("Expo Notifications chưa sẵn sàng.");
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) throw new Error("Phải cấp quyền thông báo để kiểm tra âm thanh hệ thống Android.");
  await Notifications.setNotificationChannelAsync("new-orders-v1", {
    name: "Đơn hàng mới",
    importance: Notifications.AndroidImportance.MAX,
    sound: "new_order_alert.mp3",
  });
  await Notifications.scheduleNotificationAsync({
    content: { title: "Kiểm tra âm thanh", body: "Âm thử cục bộ, không tạo đơn hàng.",
      sound: "new_order_alert.mp3", data: { kind: "LOCAL_SOUND_TEST" } },
    trigger: null,
  });
}
export async function adminTestRemotePush(token: string, branchId: string): Promise<string> {
  const deviceToken = await registerNative(token, branchId);
  if (!deviceToken) throw new Error("Thiết bị chưa có FCM token.");
  await AsyncStorage.setItem(ENDPOINT_KEY, deviceToken);
  const result = await request<{ testId: string }>("/push/test", token, "POST", { token: deviceToken });
  return result.testId;
}
export function listenAdminTestReceipts(
  token: string, onReceipt: (testId: string) => void,
): () => void {
  const listener = Notifications.addNotificationReceivedListener(notification => {
    const data = notification.request.content.data;
    if (data?.kind !== "TEST" || typeof data.testId !== "string") return;
    void AsyncStorage.getItem(ENDPOINT_KEY).then(endpoint => {
      if (!endpoint) return;
      return request("/push/test/receipt", token, "POST", { testId: data.testId, token: endpoint }).then(() => onReceipt(data.testId as string));
    }).catch(() => undefined);
  });
  return () => listener.remove();
}
