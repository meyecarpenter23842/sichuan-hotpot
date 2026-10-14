import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { request } from "./api";
import { markNewOrderAlerted, playOrderChime } from "./order-notifications";
import { watchOrderEvents } from "./order-realtime";

type PendingOrder = { id: string; status: string };

export function OrderAlertWatcher({ token, branchId, role, chimeEnabled }: {
  token: string; branchId: string; role: string; chimeEnabled: boolean;
}) {
  const sound = useRef(chimeEnabled);
  sound.current = chimeEnabled;
  useEffect(() => {
    if (!token || role === "KITCHEN" || role === "DRIVER") return;
    let disposed = false;
    let ids: Set<string> | null = null;
    let requestSequence = 0;
    const announce = (id: string) => {
      if (markNewOrderAlerted(branchId, id) && sound.current) playOrderChime();
    };
    const sync = async () => {
      const current = ++requestSequence;
      try {
        const rows = await request<PendingOrder[]>("/admin/orders/" + branchId, token);
        if (disposed || current !== requestSequence) return;
        const pending = new Set(rows.filter(row => row.status === "PENDING").map(row => row.id));
        if (ids) for (const id of pending) if (!ids.has(id)) announce(id);
        ids = pending;
      } catch { /* The queue retains its own error state and recovery polling. */ }
    };
    void sync();
    const stop = watchOrderEvents({
      token, branchId, onReady: () => { void sync(); },
      onChange: event => {
        if (event.type === "order.created" && event.orderId) announce(event.orderId);
        void sync();
      },
    });
    const interval = setInterval(() => {
      if (AppState.currentState === "active") void sync();
    }, 15000);
    const subscription = AppState.addEventListener("change", state => {
      if (state === "active") void sync();
    });
    return () => {
      disposed = true;
      stop();
      clearInterval(interval);
      subscription.remove();
    };
  }, [branchId, token, role]);
  return null;
}
