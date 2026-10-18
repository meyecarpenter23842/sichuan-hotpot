import { apiRequest } from "./api";
import {
  ensureHotpotServiceWorkerRegistration,
  webPushSupportError,
} from "./web-push-service-worker";

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

async function registerWeb(accessToken: string, askPermission: boolean): Promise<void> {
  const supportError = webPushSupportError();
  if (supportError) {
    if (askPermission) throw new Error(supportError);
    return;
  }

  if (Notification.permission === "denied") {
    if (askPermission) {
      throw new Error("Quyền thông báo đang bị chặn. Hãy bật lại trong Cài đặt của trình duyệt hoặc thiết bị.");
    }
    return;
  }
  if (askPermission && Notification.permission === "default") {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      throw new Error(permission === "denied"
        ? "Quyền thông báo đang bị chặn. Hãy bật lại trong Cài đặt của trình duyệt hoặc thiết bị."
        : "Chưa cấp quyền thông báo. Có thể bật lại khi sẵn sàng.");
    }
  }
  if (Notification.permission !== "granted") return;

  const config = await apiRequest<PushConfig>("/push/config", { accessToken });
  if (!config.enabled || !config.publicKey) {
    if (askPermission) throw new Error("Máy chủ chưa cấu hình Web Push.");
    return;
  }

  const registration = await ensureHotpotServiceWorkerRegistration();
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: vapidKey(config.publicKey),
    });
  }
  const json = subscription.toJSON();
  if (!json.keys?.p256dh || !json.keys?.auth) throw new Error("Không lấy được khóa Web Push của thiết bị.");
  await apiRequest("/push/subscriptions", {
    method: "POST", accessToken,
    body: {
      scope: "CUSTOMER", transport: "WEB_PUSH", token: subscription.endpoint,
      p256dh: json.keys.p256dh, auth: json.keys.auth,
    },
  });
}

export async function configureCustomerNotificationPresentation(): Promise<void> {
  if (webPushSupportError()) return;
  await ensureHotpotServiceWorkerRegistration();
}

export async function enableCustomerPush(accessToken: string): Promise<void> {
  await registerWeb(accessToken, true);
}

export async function refreshCustomerPushIfAllowed(accessToken: string): Promise<void> {
  await registerWeb(accessToken, false);
}

export async function watchCustomerNotificationResponses(
  _onOpenOrder: (orderId: string) => void,
): Promise<() => void> {
  return () => undefined;
}

export type PushTestStatus = { permission: string; firebase: string; token: string; sound: string };
export async function customerPushTestStatus(): Promise<PushTestStatus> {
  return { permission: typeof Notification === "undefined" ? "Không hỗ trợ" : Notification.permission,
    firebase: "Chỉ dành cho APK Android", token: "Không dùng FCM", sound: "Âm hệ thống trình duyệt" };
}
export async function customerTestLocalSound(): Promise<void> {
  throw new Error("Kiểm tra âm thanh riêng chỉ hỗ trợ APK Android.");
}
export async function customerTestRemotePush(_accessToken: string, _delaySeconds = 0): Promise<string> {
  throw new Error("Kiểm tra FCM chỉ hỗ trợ APK Android.");
}
export function listenCustomerTestReceipts(_accessToken: string, _onReceipt: (testId: string) => void): () => void {
  return () => undefined;
}
export async function disableCustomerPush(accessToken: string): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  await apiRequest("/push/subscriptions/remove", {
    method: "POST", accessToken, body: { token: subscription.endpoint },
  });
  await subscription.unsubscribe();
}
