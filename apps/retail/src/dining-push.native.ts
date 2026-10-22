import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { api, currentSession } from "./pos-api";
import { API_ORIGIN } from "./api-origin";

const CHANNEL_ID = "retail-qr-v1";
const PUSH_KEY = "hotpot.retail.fcm-registration.v1";
type Registration = { token: string; branchId: string };

async function channel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: "Yêu cầu QR bán tại quán",
    importance: Notifications.AndroidImportance.MAX,
    sound: "retail_qr_alert.mp3",
    vibrationPattern: [0, 300, 160, 300],
    enableVibrate: true,
    showBadge: true,
  });
}

export function configureRetailNotifications(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true, shouldSetBadge: false,
      shouldShowBanner: true, shouldShowList: true,
    }),
  });
  void channel().catch(() => undefined);
}

async function stored(): Promise<Registration | null> {
  const raw = await AsyncStorage.getItem(PUSH_KEY);
  if (!raw) return null;
  try {
    const x = JSON.parse(raw) as Partial<Registration>;
    if (typeof x.token === "string" && x.token.length > 0 &&
      typeof x.branchId === "string" && x.branchId.length > 0) return x as Registration;
  } catch { /* invalid old registration */ }
  return null;
}

async function revoke(registration: Registration, accessToken: string | null): Promise<void> {
  if (!accessToken) return;
  // Token captured before logout, never sent in URL or logged.
  const response = await fetch(API_ORIGIN + "/push/subscriptions/remove", {
    method: "POST", headers: { Authorization: "Bearer " + accessToken,
      "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ token: registration.token }),
  });
  if (!response.ok) throw new Error("Không thể hủy đăng ký FCM trên máy chủ.");
}

async function register(branchId: string, prompt: boolean): Promise<void> {
  if (Platform.OS !== "android") throw new Error("FCM Retail chỉ hỗ trợ Android Native.");
  await channel();
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && prompt) permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) throw new Error("Chưa cấp quyền thông báo Android 13+ hoặc thiết bị đang chặn thông báo.");
  const device = await Notifications.getDevicePushTokenAsync();
  if (device.type !== "android" || typeof device.data !== "string" || !device.data) {
    throw new Error("Không lấy được token FCM của Retail. Kiểm tra Firebase client và build APK.");
  }
  const old = await stored();
  if (old && old.branchId !== branchId) await revoke(old, currentSession()?.accessToken ?? null);
  await api("/push/subscriptions", { method: "POST",
    body: { scope: "STAFF", transport: "FCM", branchId, token: device.data } });
  await AsyncStorage.setItem(PUSH_KEY, JSON.stringify({ branchId, token: device.data }));
}

export async function enableRetailDiningPush(branchId: string): Promise<void> {
  await register(branchId, true);
}

export async function refreshRetailDiningPushIfEnabled(branchId: string): Promise<void> {
  const old = await stored();
  if (!old) return;
  const permission = await Notifications.getPermissionsAsync();
  if (permission.granted) await register(branchId, false);
}

/** Switch registrations atomically by sequence; never disable then race a re-enable. */
export async function changeRetailDiningPushBranch(branchId: string): Promise<void> {
  const old = await stored();
  if (!old || old.branchId === branchId) return;
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;
  await register(branchId, false);
}

export async function disableRetailDiningPush(): Promise<void> {
  const accessToken = currentSession()?.accessToken ?? null;
  const old = await stored();
  if (!old) return;
  // Logout clears local FCM intent even when offline; remote endpoint may remain
  // until its authorization/expiry is addressed by backend lifecycle.
  try { await revoke(old, accessToken); }
  finally { await AsyncStorage.removeItem(PUSH_KEY); }
}

export function watchRetailNotificationResponses(onOpen: () => void): () => void {
  const open = (response: Notifications.NotificationResponse | null) => {
    const data = response?.notification.request.content.data;
    if (data?.kind === "DINING_PENDING" || data?.type === "dining.pending") onOpen();
  };
  void Notifications.getLastNotificationResponseAsync().then(open).catch(() => undefined);
  const listener = Notifications.addNotificationResponseReceivedListener(open);
  return () => listener.remove();
}

export async function isRetailPushRegistered(): Promise<boolean> {
  return !!(await stored());
}

async function scheduleQrAlert(test: boolean): Promise<void> {
  if (Platform.OS !== "android") throw new Error("Âm thanh thông báo chỉ hỗ trợ Android.");
  let permission = await Notifications.getPermissionsAsync();
  // The test button is an explicit user gesture: it may request permission.
  // Automatic realtime alerts never open a surprise permission dialog.
  if (!permission.granted && test) permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) {
    if (test) throw new Error("Cần cấp quyền thông báo để thử âm. Kiểm tra cả chế độ im lặng Android.");
    return;
  }
  await channel();
  await Notifications.scheduleNotificationAsync({
    content: { title: test ? "Thử âm Retail" : "Yêu cầu QR chờ duyệt",
      body: test ? "Kiểm tra âm QR, không tạo đơn hay hóa đơn." : "Có yêu cầu QR tại quán cần nhân viên xem.",
      sound: "retail_qr_alert.mp3",
      data: { kind: test ? "RETAIL_SOUND_TEST" : "DINING_PENDING" } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 1, channelId: CHANNEL_ID },
  });
}
export async function testRetailNativeSound(): Promise<void> { return scheduleQrAlert(true); }
export async function playLocalRetailQrAlert(): Promise<void> { return scheduleQrAlert(false); }
