let registrationPromise: Promise<ServiceWorkerRegistration> | null = null;

function isIosDevice() {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function webPushSupportError(): string | null {
  if (typeof navigator === "undefined" || typeof window === "undefined") {
    return "Trình duyệt này chưa hỗ trợ thông báo nền.";
  }
  if (isIosDevice() && !isStandalone()) {
    return "Trên iPhone/iPad, hãy mở bằng Safari → Chia sẻ → Thêm vào Màn hình chính, rồi mở ứng dụng từ biểu tượng vừa tạo để bật thông báo.";
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return "Trình duyệt hoặc thiết bị này chưa hỗ trợ Web Push.";
  }
  return null;
}

export function ensureHotpotServiceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  const supportError = webPushSupportError();
  if (supportError) return Promise.reject(new Error(supportError));
  if (registrationPromise) return registrationPromise;

  registrationPromise = (async () => {
    const registration = await navigator.serviceWorker.register("/hotpot-sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
    void registration.update().catch(() => undefined);
    return navigator.serviceWorker.ready;
  })().catch(error => {
    registrationPromise = null;
    throw error;
  });

  return registrationPromise;
}
