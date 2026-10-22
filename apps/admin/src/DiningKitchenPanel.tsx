import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { request } from "./api";
import { watchOrderEvents } from "./order-realtime";
import { Action, Notice } from "./ui";
import { c } from "./theme";

type Phase = "APPROVED" | "PREPARING" | "READY" | "SERVED";
type Item = { productName: string; variantName: string | null; quantity: number;
  note: string | null; modifiers: { name: string }[];
  comboItems: { productName: string; variantName: string | null; quantity: number }[] };
type Ticket = { id: string; status: Phase; createdAt: string; customerNote: string | null;
  session: { table: { code: string; name: string } }; items: Item[] };
const next = {
  APPROVED: { status: "PREPARING", label: "Bắt đầu làm" },
  PREPARING: { status: "READY", label: "Món đã xong" },
  READY: { status: "SERVED", label: "Đã phục vụ" },
} as const;

export function DiningKitchenPanel({ token, branchId }: { token: string; branchId: string }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const requestId = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const data = await request<Ticket[]>("/dining/branches/" + branchId + "/kitchen", token);
      if (id === requestId.current) { setTickets(data); setError(""); setReady(true); }
    } catch (cause) {
      if (id === requestId.current) {
        setError(cause instanceof Error ? cause.message : "Không lấy được phiếu món tại bàn.");
        setReady(true);
      }
    }
  }, [token, branchId]);
  useEffect(() => {
    setReady(false); setTickets([]); setError("");
    void refresh();
    const stop = watchOrderEvents({
      branchId, token, onReady: () => { void refresh(); },
      onChange: event => { if (event.type.startsWith("dining.")) void refresh(); },
    });
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void refresh();
    }, 12000);
    const sub = AppState.addEventListener("change", state => {
      if (state === "active") void refresh();
    });
    return () => { requestId.current++; stop(); clearInterval(timer); sub.remove(); };
  }, [refresh, branchId, token]);

  const progress = async (ticket: Ticket) => {
    const transition = next[ticket.status as keyof typeof next];
    if (!transition || busy) return;
    setBusy(ticket.id); setError("");
    try {
      await request("/dining/branches/" + branchId + "/tickets/" + ticket.id + "/kitchen-status",
        token, "POST", { expectedStatus: ticket.status, nextStatus: transition.status });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Trạng thái phiếu đã thay đổi.");
      await refresh();
    } finally { setBusy(null); }
  };
  const visible = tickets.filter(t => t.status !== "SERVED");
  return <View style={s.panel}>
    <Pressable accessibilityRole="button" accessibilityLabel="Hiện ẩn món tại bàn"
      onPress={() => setExpanded(value => !value)} style={s.head}>
      <Text style={s.title}>🍲 Món tại bàn ({visible.length})</Text>
      <Text style={s.hint}>{expanded ? "Thu gọn ▲" : "Mở rộng ▼"}</Text>
    </Pressable>
    {expanded && <>
      {!!error && <Notice error text={error} />}
      {!ready ? <ActivityIndicator color={c.red} /> :
        !visible.length ? <Text style={s.empty}>Chưa có phiếu tại bàn được duyệt.</Text> :
        <ScrollView style={s.scroll} nestedScrollEnabled keyboardShouldPersistTaps="handled"
          contentContainerStyle={s.list}>
          {visible.map(ticket => {
            const transition = next[ticket.status as keyof typeof next];
            return <View key={ticket.id} style={s.card}>
              <View style={s.row}>
                <Text style={s.code}>{ticket.session.table.name} · {ticket.session.table.code}</Text>
                <Text style={s.status}>{ticket.status === "APPROVED" ? "Món mới" :
                  ticket.status === "PREPARING" ? "Đang làm" : "Đã xong"}</Text>
              </View>
              <Text style={s.hint}>Lượt gọi #{ticket.id.slice(0, 8)} · {new Date(ticket.createdAt).toLocaleTimeString("vi-VN")}</Text>
              {ticket.items.map((item, i) => <View key={i} style={s.item}>
                <Text style={s.itemName}>{item.quantity} × {item.productName}
                  {item.variantName ? " · " + item.variantName : ""}</Text>
                {!!item.note && <Text style={s.note}>Ghi chú: {item.note}</Text>}
                {!!item.modifiers.length && <Text style={s.note}>
                  {item.modifiers.map(m => m.name).join(" · ")}</Text>}
                {item.comboItems.map((child, j) => <Text key={j} style={s.note}>
                  + {child.quantity} × {child.productName}{child.variantName ? " · " + child.variantName : ""}</Text>)}
              </View>)}
              {!!ticket.customerNote && <Text style={s.note}>Ghi chú phiếu: {ticket.customerNote}</Text>}
              {transition && <Action label={busy === ticket.id ? "Đang cập nhật..." : transition.label}
                disabled={busy !== null} onPress={() => { void progress(ticket); }} />}
            </View>;
          })}
        </ScrollView>}
    </>}
  </View>;
}
const s = StyleSheet.create({
  panel: { borderBottomWidth: 1, borderBottomColor: c.line, backgroundColor: "#FFF8F1",
    paddingHorizontal: 10, paddingVertical: 7, gap: 8, maxHeight: 300 },
  head: { minHeight: 44, flexDirection: "row", gap: 10,
    alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 15, color: c.ink, fontWeight: "900" },
  hint: { color: c.secondary, fontSize: 11 },
  empty: { color: c.secondary, fontSize: 12, paddingVertical: 10 },
  scroll: { maxHeight: 230 },
  list: { gap: 9, paddingBottom: 10 },
  card: { borderWidth: 1, borderColor: "#EAD4C5", backgroundColor: c.white,
    borderRadius: 11, padding: 11, gap: 7 },
  row: { flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", gap: 8 },
  code: { fontSize: 14, fontWeight: "900", color: c.ink, flex: 1 },
  status: { fontSize: 12, fontWeight: "800", color: c.red },
  item: { gap: 3 },
  itemName: { color: c.ink, fontWeight: "700", fontSize: 13 },
  note: { color: c.secondary, fontSize: 12, lineHeight: 18 },
});
