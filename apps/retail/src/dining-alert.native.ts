import { isRetailPushRegistered, testRetailNativeSound } from "./dining-push";

/** When FCM is active, the OS owns audible delivery to avoid double chimes. */
export async function playRetailQrAlert(test = false): Promise<void> {
  if (test) return testRetailNativeSound();
  if (await isRetailPushRegistered()) return;
  // Without registered push, sound a real local Android notification once per
  // realtime ticket (deduplicated by App), subject to device notification settings.
  try { await testRetailNativeSound(); }
  catch { /* permissions/device policy can silence automatic alerts */ }
}
