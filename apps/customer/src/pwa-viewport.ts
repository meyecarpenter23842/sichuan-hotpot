/**
 * Keep the installed Customer PWA at the device layout width.
 * Do not cancel one-finger scrolling or form interactions.
 * System-level accessibility magnification remains OS-controlled.
 */
export function configureCustomerViewport(): void {
  if (typeof document === "undefined") return;
  const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
    ?? document.createElement("meta");
  viewport.name = "viewport";
  viewport.content = "width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover";
  if (!viewport.parentNode) document.head.appendChild(viewport);
  document.documentElement.style.setProperty("touch-action", "pan-x pan-y");
  document.documentElement.style.setProperty("overscroll-behavior-x", "none");
  // Safari's legacy gesture events do not honor touch-action consistently.
  for (const event of ["gesturestart", "gesturechange"] as const) {
    document.addEventListener(event, e => e.preventDefault(), { passive: false });
  }
}
