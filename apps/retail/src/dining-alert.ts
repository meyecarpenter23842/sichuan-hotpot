// Browser-based Retail only. Sounds require a prior user gesture on Safari/Chrome.
let audio: AudioContext | null = null;
export async function playRetailQrAlert(test = false): Promise<void> {
  if (typeof window === "undefined") return;
  const browser = window as typeof window & { webkitAudioContext?: typeof AudioContext };
  const Audio = browser.AudioContext ?? browser.webkitAudioContext;
  if (!Audio) { if (test) throw new Error("Thiết bị không hỗ trợ âm thanh Web Audio."); return; }
  audio ??= new Audio();
  if (test && audio.state === "suspended") await audio.resume();
  if (audio.state !== "running") {
    if (test) throw new Error("Trình duyệt đang chặn âm; hãy chạm nút thử lại.");
    return;
  }
  const when = audio.currentTime;
  for (const offset of [0, 0.18, 0.36]) {
    const tone = audio.createOscillator();
    const gain = audio.createGain();
    tone.type = "sine"; tone.frequency.value = 810;
    gain.gain.setValueAtTime(0.0001, when + offset);
    gain.gain.exponentialRampToValueAtTime(0.14, when + offset + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + offset + 0.14);
    tone.connect(gain); gain.connect(audio.destination);
    tone.start(when + offset); tone.stop(when + offset + 0.15);
  }
}
