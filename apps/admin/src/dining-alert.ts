// Best-effort foreground sound; a user tap must unlock Web Audio on Safari/Chrome.
let audio: AudioContext | null = null;
export async function playDiningAlert(test = false): Promise<void> {
  if (typeof window === "undefined") return;
  const win = window as typeof window & { webkitAudioContext?: typeof AudioContext };
  const Audio = win.AudioContext ?? win.webkitAudioContext;
  if (!Audio) {
    if (test) throw new Error("Trình duyệt chưa hỗ trợ Web Audio.");
    return;
  }
  audio ??= new Audio();
  if (test && audio.state === "suspended") await audio.resume();
  if (audio.state !== "running") {
    if (test) throw new Error("Safari/Chrome đang chặn âm thanh. Hãy chạm thử lại.");
    return;
  }
  const when = audio.currentTime;
  for (const offset of [0, 0.18]) {
    const tone = audio.createOscillator();
    const gain = audio.createGain();
    tone.type = "sine"; tone.frequency.value = 740;
    gain.gain.setValueAtTime(0.0001, when + offset);
    gain.gain.exponentialRampToValueAtTime(0.16, when + offset + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + offset + 0.15);
    tone.connect(gain); gain.connect(audio.destination);
    tone.start(when + offset); tone.stop(when + offset + 0.16);
  }
  // No permission prompt on background events. On-screen Test never creates a ticket.
  if (test && typeof Notification !== "undefined" && Notification.permission === "granted") {
    new Notification("Thử chuông yêu cầu QR", { body: "Thông báo thử, không tạo đơn." });
  }
}
