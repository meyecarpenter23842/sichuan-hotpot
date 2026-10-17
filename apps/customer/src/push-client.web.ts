import { apiRequest } from "./api";

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
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)
      || !("PushManager" in globalThis) || !("Notification" in globalThis)) {
    throw new Error("Trình duyệt này chưa hỗ trợ thông báo nền.");
  }
  if (askPermission && Notification.permission === "default") await Notification.requestPermission();
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
  if (!json.keys?.p256dh || !json.keys?.auth) throw new Error("Không lấy được khóa Web Push của thiết bị.");
  await apiRequest("/push/subscriptions", {
    method: "POST", accessToken,
    body: {
      scope: "CUSTOMER", transport: "WEB_PUSH", token: subscription.endpoint,
      p256dh: json.keys.p256dh, auth: json.keys.auth,
    },
  });
}

export async function configureCustomerNotificationPresentation(): Promise<void> {}

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
