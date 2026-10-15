import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform, Vibration } from "react-native";

const KEY = "sichuan.admin.order.chime.v1";
let context: AudioContext | null = null;

export async function loadOrderChime(): Promise<boolean> {
  return (await AsyncStorage.getItem(KEY)) === "on";
}

export async function saveOrderChime(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(KEY, enabled ? "on" : "off");
}

// A deliberate tap to enable sound unlocks browser audio on Safari/Chrome.
// Android vibrates as an additional cue until packaged app notification audio is configured.
/** Classic double-ring bell (~3 seconds), deliberately longer than the old 0.6s beep. */
export function playOrderChime(): void {
  if (Platform.OS !== "web") {
    // Native fallback until the packaged Android app has an approved sound asset.
    Vibration.vibrate([0, 900, 240, 900, 240, 650]);
    return;
  }
  try {
    if (typeof window === "undefined") return;
    const Audio = window.AudioContext;
    if (!Audio) return;
    context ??= new Audio();
    if (context.state === "suspended") void context.resume();
    const start = context.currentTime + 0.02;
    // Two classic telephone-style rings, with a distinct pause between them.
    for (const offset of [0, 1.5]) {
      for (const [frequency, volume] of [[610, 0.14], [810, 0.11]] as const) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "triangle";
        oscillator.frequency.value = frequency;
        oscillator.connect(gain);
        gain.connect(context.destination);
        // Tremolo creates the "reng reng" bell cadence, not a short notification beep.
        gain.gain.setValueAtTime(0.0001, start + offset);
        for (let i = 0; i < 12; i++) {
          const t = start + offset + i * 0.098;
          gain.gain.setValueAtTime(0.0001, t);
          gain.gain.linearRampToValueAtTime(volume, t + 0.018);
          gain.gain.setValueAtTime(volume, t + 0.063);
          gain.gain.linearRampToValueAtTime(0.0001, t + 0.096);
        }
        oscillator.start(start + offset);
        oscillator.stop(start + offset + 1.20);
      }
    }
  } catch {
    // Browser autoplay policy can mute unsolicited sound; orders still reconcile.
  }
}

const recentlyNotified = new Set<string>();
/** One sound per order per device; survives navigation and web page reload. */
export function markNewOrderAlerted(branchId: string, orderId: string): boolean {
  const key = "sichuan.admin.order.alert." + branchId + "." + orderId;
  if (recentlyNotified.has(key)) return false;
  recentlyNotified.add(key);
  if (Platform.OS === "web" && typeof localStorage !== "undefined") {
    try {
      const previous = Number(localStorage.getItem(key) ?? 0);
      if (Date.now() - previous < 86400000) return false;
      localStorage.setItem(key, String(Date.now()));
    } catch { /* Private browsing storage can be unavailable. */ }
  }
  return true;
}
