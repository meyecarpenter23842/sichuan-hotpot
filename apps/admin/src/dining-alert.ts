// Foreground PWA alerts are best effort: browser autoplay and notification permissions apply.
export async function playDiningAlert(test = false): Promise<void> {
  if (typeof window === "undefined") return;
  const win = window as typeof window & { webkitAudioContext?: typeof AudioContext };
  const Audio = win.AudioContext ?? win.webkitAudioContext;
  if (Audio) {
    const context = new Audio();
    try {
      if (context.state === "suspended") await context.resume();
      if (context.state === "running") {
        for (const offset of [0, 0.18]) {
          const tone = context.createOscillator();
          const gain = context.createGain();
          tone.type = "sine"; tone.frequency.value = 740;
          gain.gain.setValueAtTime(0.0001, context.currentTime + offset);
          gain.gain.exponentialRampToValueAtTime(0.16, context.currentTime + offset + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + offset + 0.15);
          tone.connect(gain); gain.connect(context.destination);
          tone.start(context.currentTime + offset);
          tone.stop(context.currentTime + offset + 0.16);
        }
      } else if (test) throw new Error("Safari/Chrome đang chặn tự phát âm. Chạm nút thử lại.");
    } finally { void context.close().catch(() => undefined); }
  } else if (test) {
    throw new Error("Trình duyệt không hỗ trợ phát âm tại trang này.");
  }
  // No notification permission prompt on background changes: only direct user action can request it.
  if (test && typeof Notification !== "undefined" && Notification.permission === "granted") {
    new Notification("Thử chuông yêu cầu QR", { body: "Thông báo thử, không tạo đơn." });
  }
}
