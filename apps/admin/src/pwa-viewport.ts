/**
 * Keep the installed Admin PWA at the device layout width.
 * Do not cancel one-finger scrolling or form interactions.
 * System-level accessibility magnification remains OS-controlled.
 */
export function configureAdminViewport(): void {
  if (typeof document === "undefined") return;
  const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
    ?? document.createElement("meta");
  viewport.name = "viewport";
  viewport.content = "width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover";
  if (!viewport.parentNode) document.head.appendChild(viewport);
  document.documentElement.style.setProperty("touch-action", "pan-x pan-y");
  document.documentElement.style.setProperty("overscroll-behavior-x", "none");

  // Expo's web root can retain an old height when an installed iPhone PWA
  // resumes or Safari changes the visual viewport. Lock the document itself,
  // leaving the app's ScrollViews responsible for vertical scrolling.
  const styleId = "admin-pwa-viewport-layout";
  if (document.getElementById(styleId)) return;
  const layout = document.createElement("style");
  layout.id = styleId;
  layout.textContent = `
    html, body {
      width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;
      overscroll-behavior: none;
      background-color: #5B0A0E;
    }
    #root {
      display: flex;
      width: 100%;
      height: var(--admin-app-viewport-height, 100dvh);
      min-height: 0;
      overflow: hidden;
      overscroll-behavior: none;
    }
  `;
  document.head.appendChild(layout);

  const syncHeight = () => {
    if (document.visibilityState === "hidden") return;
    // Do not move the bottom navigation above the on-screen keyboard.
    // Safari will deliver another visualViewport resize when it closes.
    if (document.activeElement?.matches("input,textarea,select,[contenteditable='true']")) return;
    const visual = window.visualViewport;
    const height = visual && visual.scale === 1 ? visual.height : window.innerHeight;
    if (Number.isFinite(height) && height > 0) {
      document.documentElement.style.setProperty("--admin-app-viewport-height", `${Math.round(height)}px`);
    }
  };
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      syncHeight();
    });
  };
  // Both window and visualViewport events matter on iOS PWA resume/rotation.
  window.addEventListener("resize", schedule);
  window.addEventListener("orientationchange", schedule);
  window.addEventListener("pageshow", schedule);
  window.addEventListener("focus", schedule);
  document.addEventListener("visibilitychange", schedule);
  document.addEventListener("focusout", schedule);
  window.visualViewport?.addEventListener("resize", schedule);
  syncHeight();

  // Safari's legacy gesture events do not honor touch-action consistently.
  for (const event of ["gesturestart", "gesturechange"] as const) {
    document.addEventListener(event, e => e.preventDefault(), { passive: false });
  }
}
