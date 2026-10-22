import { API_ORIGIN, isValidApiOrigin } from "./api-origin";

/** Socket hints contain only IDs/status; caller must re-fetch branch-scoped HTTP snapshots. */
export function watchRetailDining(token: string, branchId: string, callbacks: {
  onReady: () => void;
  onChange: (hint: { type: string; ticketId?: string; status?: string }) => void;
}): () => void {
  if (typeof WebSocket === "undefined" || !isValidApiOrigin(API_ORIGIN)) return () => undefined;
  const url = new URL(API_ORIGIN);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/realtime";
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let socket: WebSocket | null = null;
  let attempt = 0;
  const connect = () => {
    if (stopped) return;
    try {
      const current = new WebSocket(url.toString()); socket = current;
      current.onopen = () => {
        attempt = 0;
        current.send(JSON.stringify({ type: "subscribe", scope: "staff", token, branchId }));
      };
      current.onmessage = message => {
        try {
          const event = JSON.parse(String(message.data)) as {
            type: string; branchId?: string; ticketId?: string; status?: string };
          if (event.type === "ready") callbacks.onReady();
          else if (event.type.startsWith("dining.") && event.branchId === branchId)
            callbacks.onChange(event);
        } catch { /* Bad transport hint does not affect HTTP truth. */ }
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
