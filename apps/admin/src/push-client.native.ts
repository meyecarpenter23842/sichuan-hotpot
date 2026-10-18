import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { request } from "./api";
import { Platform } from "react-native";

const ENDPOINT_KEY = "sichuan.admin.push-endpoint.v1";
// A channel's sound is immutable once Android creates it. v2 may have been
// created with the default sound before the custom audio was configured.
const ORDER_CHANNEL_ID = "new-orders-v3";
const ORDER_SOUND_FILE = "new_order_alert.mp3";
async function ensureOrderSoundChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(ORDER_CHANNEL_ID, {
    name: "Đơn hàng mới (âm riêng)",
    description: "Đơn mới cần quản trị xác nhận",
    importance: Notifications.AndroidImportance.MAX,
    sound: ORDER_SOUND_FILE,
    vibrationPattern: [0, 450, 180, 450],
    enableVibrate: true,
    showBadge: true,
  });
}

async function registerNative(token: string, branchId: string): Promise<string> {
  await ensureOrderSoundChannel();
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
  // Initialize the real FCM channel before any token can be registered.
  await ensureOrderSoundChannel();
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
  const channel = await Notifications.getNotificationChannelAsync(ORDER_CHANNEL_ID);
  const channelSound = channel?.sound ?? null;
  const sound = !channel ? "Chưa tạo channel âm riêng"
    : channelSound === "custom"
      ? "Âm tùy chỉnh của channel " + ORDER_CHANNEL_ID + " đã bật (chưa xác nhận nghe thực tế)"
      : "Channel " + ORDER_CHANNEL_ID + " đang dùng âm " + (channelSound ?? "tắt âm")
        + ". Kiểm tra thiết lập thông báo Android.";
  if (!permission.granted) return { permission: permission.canAskAgain ? "Chưa cấp" : "Bị từ chối",
    firebase: "Chưa xác minh", token: "Chưa đăng ký", sound };
  try {
    const device = await Notifications.getDevicePushTokenAsync();
    return { permission: "Đã cấp", firebase: "Khởi tạo Firebase và lấy token thành công",
      token: device.type === "android" && typeof device.data === "string" ? "Sẵn sàng" : "Không hợp lệ",
      sound };
  } catch (error) {
    return { permission: "Đã cấp", firebase: error instanceof Error ? error.message : "Không truy cập được Firebase",
      token: "Không khả dụng", sound };
  }
}
export async function adminTestLocalSound(): Promise<void> {
  if (!Notifications) throw new Error("Expo Notifications chưa sẵn sàng.");
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) throw new Error("Phải cấp quyền thông báo để kiểm tra âm thanh hệ thống Android.");
  await ensureOrderSoundChannel();
  await Notifications.scheduleNotificationAsync({
    content: { title: "Kiểm tra âm thanh", body: "Âm thử cục bộ, không tạo đơn hàng.",
      sound: "new_order_alert.mp3", data: { kind: "LOCAL_SOUND_TEST" } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 1, channelId: ORDER_CHANNEL_ID },
  });
}
export async function adminTestRemotePush(token: string, branchId: string, delaySeconds = 0): Promise<string> {
  const deviceToken = await registerNative(token, branchId);
  if (!deviceToken) throw new Error("Thiết bị chưa có FCM token.");
  await AsyncStorage.setItem(ENDPOINT_KEY, deviceToken);
  const result = await request<{ testId: string }>("/push/test", token, "POST", { token: deviceToken, delaySeconds });
  return result.testId;
}
export type AdminFcmTestState = { status: "scheduled" | "sent_to_fcm" | "failed" | "received_on_device";
  received: boolean; failureCode?: string | null };
export async function adminPushRemoteTestStatus(token: string, testId: string): Promise<AdminFcmTestState> {
  return request<AdminFcmTestState>("/push/test/status", token, "POST", { testId });
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
