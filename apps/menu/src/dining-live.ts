import { API_ORIGIN, isValidApiOrigin } from "./api-origin";

/** Guest credential never appears in URL. Socket connects only to an HTTPS-origin WebSocket. */
export function watchGuestDining(credential: string, sessionId: string,
  onChange: () => void): () => void {
  if (typeof WebSocket === "undefined" || !isValidApiOrigin(API_ORIGIN)) return () => undefined;
  const url = new URL(API_ORIGIN);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/realtime";
  let stopped = false;
  let attempt = 0;
  let socket: WebSocket | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const connect = () => {
    if (stopped) return;
    try {
      const current = new WebSocket(url.toString()); socket = current;
      current.onopen = () => {
        attempt = 0;
        current.send(JSON.stringify({ type: "subscribe", scope: "dining_guest", token: credential }));
      };
      current.onmessage = message => {
        try {
          const event = JSON.parse(String(message.data)) as {
            type: string; sessionId?: string };
          if (event.type === "ready" || (event.type === "dining.changed" && event.sessionId === sessionId))
            onChange();
        } catch { /* Existing HTTP poll is fallback. */ }
      };
      current.onerror = () => undefined;
      current.onclose = () => {
        if (!stopped) retry = setTimeout(connect, Math.min(30000, 1000 * (2 ** Math.min(attempt++, 5))));
      };
    } catch { retry = setTimeout(connect, 5000); }
  };
  connect();
  return () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    if (socket) {
      const closing = socket; closing.onclose = null; closing.onmessage = null;
      if (closing.readyState === WebSocket.OPEN) closing.close();
      else if (closing.readyState === WebSocket.CONNECTING) closing.onopen = () => closing.close();
    }
  };
}
