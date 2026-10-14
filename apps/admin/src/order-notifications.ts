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
export function playOrderChime(): void {
  if (Platform.OS !== "web") {
    Vibration.vibrate(280);
    return;
  }
  try {
    if (typeof window === "undefined") return;
    const Audio = window.AudioContext;
    if (!Audio) return;
    context ??= new Audio();
    if (context.state === "suspended") void context.resume();
    const start = context.currentTime;
    for (const [index, pitch] of [740, 988, 740].entries()) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = pitch;
      gain.gain.setValueAtTime(0.0001, start + index * 0.19);
      gain.gain.exponentialRampToValueAtTime(0.11, start + index * 0.19 + 0.035);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + index * 0.19 + 0.17);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start + index * 0.19);
      oscillator.stop(start + index * 0.19 + 0.18);
    }
  } catch {
    // Audio may be denied by browser autoplay policy; order data still refreshes.
  }
}
