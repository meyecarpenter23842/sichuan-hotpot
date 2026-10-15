const apiOrigin = (process.env.EXPO_PUBLIC_API_BASE_URL ?? "").trim().replace(/\/$/, "");

export interface OrderRealtimeMessage {
  type: "ready" | "order.created" | "order.status" | "order.overdue";
  orderId?: string;
  branchId?: string;
  status?: string;
  eventId?: string;
}

export function watchOrderEvents(options: {
  token: string;
  branchId: string;
  onReady: () => void;
  onChange: (event: OrderRealtimeMessage) => void;
}): () => void {
  if (typeof WebSocket === "undefined") return () => undefined;
  let origin: URL;
  try { origin = new URL(apiOrigin); }
  catch { return () => undefined; }
  const local = origin.protocol === "http:" && ["127.0.0.1", "localhost"].includes(origin.hostname);
  if (!local && origin.protocol !== "https:") return () => undefined;
  origin.protocol = origin.protocol === "https:" ? "wss:" : "ws:";
  origin.pathname = "/realtime";
  origin.search = "";
  let stopped = false;
  let socket: WebSocket | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let attempts = 0;
  const connect = () => {
    if (stopped) return;
    try {
      socket = new WebSocket(origin.toString());
      socket.onopen = () => {
        attempts = 0;
        socket?.send(JSON.stringify({ type: "subscribe", scope: "staff",
          token: options.token, branchId: options.branchId }));
      };
      socket.onmessage = message => {
        try {
          const data: unknown = JSON.parse(String(message.data));
          if (!data || typeof data !== "object" || !("type" in data)) return;
          const event = data as OrderRealtimeMessage;
          if (event.type === "ready") options.onReady();
          else if (["order.created", "order.status", "order.overdue"].includes(event.type)
            && event.branchId === options.branchId) options.onChange(event);
        } catch { /* Ignore malformed transport hints. */ }
      };
      socket.onclose = () => {
        if (stopped) return;
        retry = setTimeout(connect, Math.min(30000, 1000 * (2 ** Math.min(attempts++, 5))));
      };
      // Browser already emits onclose after a failed handshake; calling close() here
      // while CONNECTING causes the misleading "closed before established" error.
      socket.onerror = () => undefined;
    } catch {
      retry = setTimeout(connect, 5000);
    }
  };
  connect();
  return () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    if (socket) {
      const pending = socket;
      pending.onclose = null;
      pending.onmessage = null;
      if (pending.readyState === WebSocket.OPEN) pending.close();
      else if (pending.readyState === WebSocket.CONNECTING) {
        // Complete the handshake before closing instead of aborting it mid-flight.
        pending.onopen = () => pending.close();
      }
    }
  };
}
