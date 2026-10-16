const apiOrigin = (process.env.EXPO_PUBLIC_API_BASE_URL ?? "").trim().replace(/\/$/, "");

export function watchCustomerOrderEvents(token: string, refresh: () => void): () => void {
  if (!token || typeof WebSocket === "undefined") return () => undefined;
  let base: URL;
  try { base = new URL(apiOrigin); } catch { return () => undefined; }
  const local = base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname);
  if (!local && base.protocol !== "https:") return () => undefined;
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.pathname = "/realtime";
  base.search = "";
  let closed = false;
  let socket: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let tries = 0;
  const connect = () => {
    if (closed) return;
    try {
      socket = new WebSocket(base.toString());
      socket.onopen = () => {
        tries = 0;
        socket?.send(JSON.stringify({ type: "subscribe", scope: "customer", token }));
      };
      socket.onmessage = event => {
        try {
          const message: unknown = JSON.parse(String(event.data));
          if (message && typeof message === "object" && "type" in message
            && ["ready", "order.created", "order.status", "order.updated"].includes(String(message.type))) {
            refresh();
          }
        } catch { /* Ignore corrupt hints and continue regular HTTP sync. */ }
      };
      socket.onclose = () => {
        if (closed) return;
        timer = setTimeout(connect, Math.min(30000, 1000 * 2 ** Math.min(tries++, 5)));
      };
      // Browser already emits onclose after a failed handshake; calling close() here
      // while CONNECTING causes the misleading "closed before established" error.
      socket.onerror = () => undefined;
    } catch {
      timer = setTimeout(connect, 5000);
    }
  };
  connect();
  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
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
