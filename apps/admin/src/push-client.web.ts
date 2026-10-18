import AsyncStorage from "@react-native-async-storage/async-storage";
import { request } from "./api";
import {
  ensureHotpotServiceWorkerRegistration,
  webPushSupportError,
} from "./web-push-service-worker";

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
  const supportError = webPushSupportError();
  if (supportError) throw new Error(supportError);

  if (Notification.permission === "denied") {
    throw new Error("Quyền thông báo đang bị chặn. Hãy bật lại trong Cài đặt của trình duyệt hoặc thiết bị.");
  }
  if (Notification.permission === "default") {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      throw new Error(permission === "denied"
        ? "Quyền thông báo đang bị chặn. Hãy bật lại trong Cài đặt của trình duyệt hoặc thiết bị."
        : "Chưa cấp quyền thông báo. Có thể bật lại khi sẵn sàng.");
    }
  }

  const config = await request<PushConfig>("/push/config", token);
  if (!config.enabled || !config.publicKey) throw new Error("Máy chủ chưa cấu hình Web Push.");

  const registration = await ensureHotpotServiceWorkerRegistration();
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: vapidKey(config.publicKey),
    });
  }
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

export async function configureAdminNotificationPresentation(): Promise<void> {
  if (webPushSupportError()) return;
  await ensureHotpotServiceWorkerRegistration();
}

export async function enableAdminPush(token: string, branchId: string): Promise<void> {
  const endpoint = await registerWeb(token, branchId);
  await AsyncStorage.setItem(ENDPOINT_KEY, endpoint);
}

export async function disableAdminPush(token: string): Promise<void> {
  const endpoint = await AsyncStorage.getItem(ENDPOINT_KEY);
  if (endpoint) {
    await request("/push/subscriptions/remove", token, "POST", { token: endpoint })
      .catch(() => undefined);
  }
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    const registration = await navigator.serviceWorker.getRegistration("/");
    const subscription = await registration?.pushManager.getSubscription();
    await subscription?.unsubscribe().catch(() => false);
  }
  await AsyncStorage.removeItem(ENDPOINT_KEY);
}

export async function refreshAdminPushIfEnabled(
  token: string, branchId: string, enabled: boolean,
): Promise<void> {
  if (!enabled || !("Notification" in globalThis) || Notification.permission !== "granted") return;
  await enableAdminPush(token, branchId);
}

export async function watchAdminNotificationResponses(
  _onOpenOrder: (orderId: string | null) => void,
): Promise<() => void> {
  return () => undefined;
}

export type PushTestStatus = { permission: string; firebase: string; token: string; sound: string };
export async function adminPushTestStatus(): Promise<PushTestStatus> {
  return { permission: typeof Notification === "undefined" ? "Không hỗ trợ" : Notification.permission,
    firebase: "Chỉ dành cho APK Android", token: "Không dùng FCM", sound: "Âm hệ thống trình duyệt" };
}
export async function adminTestLocalSound(): Promise<void> {
  throw new Error("Kiểm tra âm thanh riêng chỉ hỗ trợ APK Android.");
}
export async function adminTestRemotePush(_token: string, _branchId: string, _delaySeconds = 0): Promise<string> {
  throw new Error("Kiểm tra FCM chỉ hỗ trợ APK Android.");
}
export function listenAdminTestReceipts(_token: string, _onReceipt: (testId: string) => void): () => void {
  return () => undefined;
}

