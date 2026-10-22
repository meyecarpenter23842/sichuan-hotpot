import { api } from "./pos-api";

type PushConfig = { enabled: boolean; publicKey: string | null };
function convertKey(value: string): ArrayBuffer {
  const chars = atob(value.replace(/-/g, "+").replace(/_/g, "/")
    + "=".repeat((4 - value.length % 4) % 4));
  const result = new ArrayBuffer(chars.length);
  const bytes = new Uint8Array(result);
  for (let i = 0; i < chars.length; i++) bytes[i] = chars.charCodeAt(i);
  return result;
}
/** Called from a user gesture, never prompts on app launch or in an event callback. */
export async function enableRetailDiningPush(branchId: string): Promise<void> {
  if (typeof window === "undefined" || !("Notification" in window) ||
    !("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("Thiết bị/trình duyệt không hỗ trợ Web Push.");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Chưa cấp quyền thông báo trình duyệt.");
  const config = await api<PushConfig>("/push/config");
  if (!config.enabled || !config.publicKey) throw new Error("VPS chưa có cấu hình VAPID cho Web Push.");
  await navigator.serviceWorker.register("/hotpot-sw.js", { scope: "/" });
  const ready = await navigator.serviceWorker.ready;
  const sub = await ready.pushManager.getSubscription() ?? await ready.pushManager.subscribe({
    userVisibleOnly: true, applicationServerKey: convertKey(config.publicKey),
  });
  const raw = sub.toJSON();
  if (!raw.keys?.p256dh || !raw.keys?.auth) throw new Error("Không đọc được khóa Web Push.");
  await api("/push/subscriptions", { method: "POST", body: {
    scope: "STAFF", transport: "WEB_PUSH", branchId,
    token: sub.endpoint, p256dh: raw.keys.p256dh, auth: raw.keys.auth,
  } });
}

/** Web PWA: browser notifications use its ServiceWorker, never the native module. */
export function configureRetailNotifications(): void {}
export function watchRetailNotificationResponses(_onOpen: () => void): () => void { return () => undefined; }
export async function refreshRetailDiningPushIfEnabled(_branchId: string): Promise<void> {}
export async function disableRetailDiningPush(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const ready = await navigator.serviceWorker.ready;
  const previous = await ready.pushManager.getSubscription();
  if (!previous) return;
  // No credentials are written to browser storage. Subscription revocation is best effort.
  try { await api("/push/subscriptions/remove", { method: "POST", body: { token: previous.endpoint } }); }
  finally { await previous.unsubscribe(); }
}
