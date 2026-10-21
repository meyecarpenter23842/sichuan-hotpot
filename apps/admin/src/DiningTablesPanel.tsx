import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, AppState, Linking, Modal, Pressable, ScrollView, StyleSheet,
  Text, View, useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { request } from "./api";
import { Action, Field, Notice } from "./ui";
import { type DiningArea } from "./DiningConfigurationPanel";
import { c } from "./theme";

type LiveSession = { id: string; status: "OPEN" | "CHECKOUT" | "CLOSED";
  guestCount: number | null; openedAt: string;
  _count: { tickets: number } };
type Table = { id: string; areaId: string; code: string; name: string; isActive: boolean;
  sessions: LiveSession[] };
type Line = { id: string; productName: string; variantName: string | null;
  quantity: number; lineTotalVnd: number };
type Ticket = { id: string; sessionId: string; customerNote: string | null; createdAt: string;
  items: Line[]; session: { table: { code: string; name: string } } };
type Bill = { id: string; subtotalVnd: number; paidVnd: number; dueVnd: number;
  status: string; tickets: { id: string; status: string; items: Line[] }[] };
type Filter = "all" | "available" | "active" | "pending";
type Display = "grid" | "list";
const money = (n: number) => n.toLocaleString("vi-VN") + "đ";
const formatDate = (s: string) => new Date(s).toLocaleTimeString("vi-VN", {
  hour: "2-digit", minute: "2-digit" });
export function DiningTablesPanel({ token, branchId, role, selectedArea, onAreaChange,
  filter, onFilterChange, display, onDisplayChange, onConfigure }: {
  token: string; branchId: string; role: string;
  selectedArea: string | null; onAreaChange: (id: string | null) => void;
  filter: Filter; onFilterChange: (next: Filter) => void;
  display: Display; onDisplayChange: (next: Display) => void;
  onConfigure: () => void;
}) {
  const [areas, setAreas] = useState<DiningArea[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [approvals, setApprovals] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Table | null>(null);
  const [bill, setBill] = useState<Bill | null>(null);
  const [billLoading, setBillLoading] = useState(false);
  const [rejectTicket, setRejectTicket] = useState<Ticket | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const sequence = useRef(0);
  const { width } = useWindowDimensions();
  const base = "/dining/branches/" + branchId;
  const canApprove = ["OWNER", "MANAGER", "WAITER"].includes(role);
  const canOpen = canApprove;
  const canBill = ["OWNER", "MANAGER", "WAITER", "CASHIER"].includes(role);
  const canManage = ["OWNER", "MANAGER"].includes(role);
  const refresh = useCallback(async () => {
    const current = ++sequence.current;
    try {
      const [nextAreas, nextTables, nextApprovals] = await Promise.all([
        request<DiningArea[]>("/dining/branches/" + branchId + "/areas", token),
        request<Table[]>("/dining/branches/" + branchId + "/tables", token),
        ["OWNER", "MANAGER", "WAITER"].includes(role)
          ? request<Ticket[]>("/dining/branches/" + branchId + "/approvals", token)
          : Promise.resolve([]),
      ]);
      if (current !== sequence.current) return;
      setAreas(nextAreas); setTables(nextTables); setApprovals(nextApprovals);
      setError("");
    } catch (err) {
      if (current === sequence.current)
        setError(err instanceof Error ? err.message : "Không lấy được trạng thái bàn.");
    } finally { if (current === sequence.current) setLoading(false); }
  }, [branchId, token, role]);
  useEffect(() => {
    setLoading(true); setAreas([]); setTables([]); setApprovals([]);
    setSelected(null); setBill(null); setError(""); setNotice("");
    void refresh();
    const interval = setInterval(() => {
      if (AppState.currentState === "active") void refresh();
    }, 12000);
    const listener = AppState.addEventListener("change", state => {
      if (state === "active") void refresh();
    });
    return () => { sequence.current++; clearInterval(interval); listener.remove(); };
  }, [refresh]);

  const open = async (table: Table) => {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await request(base + "/tables/" + table.id + "/sessions", token, "POST", {});
      setNotice("Đã mở phiên " + table.name);
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Không mở được phiên."); await refresh(); }
    finally { setBusy(false); }
  };
  const inspect = async (table: Table) => {
    setSelected(table); setBill(null); setBillLoading(true);
    if (!table.sessions[0] || !canBill) { setBillLoading(false); return; }
    try { setBill(await request<Bill>(base + "/sessions/" + table.sessions[0].id, token)); }
    catch (err) { setError(err instanceof Error ? err.message : "Không đọc được hóa đơn."); }
    finally { setBillLoading(false); }
  };
  const approve = async (ticket: Ticket) => {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await request(base + "/tickets/" + ticket.id + "/approve", token, "POST");
      setNotice("Đã duyệt yêu cầu " + ticket.session.table.code + ". Bếp sẽ thấy món.");
      await refresh();
      if (selected) await inspect(selected);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không duyệt được món.");
      await refresh();
    } finally { setBusy(false); }
  };
  const reject = async () => {
    if (!rejectTicket || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await request(base + "/tickets/" + rejectTicket.id + "/reject", token, "POST",
        { reason: rejectReason.trim() });
      setRejectTicket(null); setRejectReason(""); setNotice("Đã từ chối yêu cầu và ghi lý do.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không từ chối được yêu cầu.");
      await refresh();
    } finally { setBusy(false); }
  };
  const openRetail = (table: Table) => {
    void Linking.openURL("https://retail.bepsi.click/?table=" + encodeURIComponent(table.id))
      .catch(() => setError("Không mở được trang Retail."));
  };
  const shown = tables.filter(t => (selectedArea === null || t.areaId === selectedArea) &&
    (filter === "all" || (filter === "available" && !t.sessions.length && t.isActive) ||
      (filter === "active" && !!t.sessions.length) ||
      (filter === "pending" && (t.sessions[0]?._count.tickets ?? 0) > 0)));
  const areaName = (areaId: string) => areas.find(a => a.id === areaId)?.name ?? "Khu vực";
  const pendingCount = approvals.length;
  const counts = {
    available: tables.filter(t => !t.sessions.length && t.isActive).length,
    active: tables.filter(t => t.sessions.length).length,
  };
  const columns = width >= 990 ? 4 : width >= 650 ? 3 : 2;
  // Subtract the 9px inter-card gaps BEFORE dividing; % widths overflow at 320px.
  const cardSpace = Math.min(width, 1080) - 24;
  const tileWidth = display === "list" ? "100%" : (cardSpace - (columns - 1) * 9) / columns;
  const activeSelected = selected && tables.find(t => t.id === selected.id) || selected;
  const pendingForSelected = activeSelected ? approvals.filter(t => t.sessionId === activeSelected.sessions[0]?.id) : [];
  return <View style={s.screen}>
    <View style={s.header}>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={s.title}>Sơ đồ bàn</Text>
        <Text style={s.sub}>Trống {counts.available} · Có khách {counts.active} · Chờ duyệt {pendingCount}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Làm mới bàn" style={s.refresh}
        onPress={() => { void refresh(); }}><Text style={s.refreshText}>↻</Text></Pressable>
      {canManage && <Pressable accessibilityRole="button" style={s.manage} onPress={onConfigure}>
        <Text style={s.manageText}>Thiết lập</Text>
      </Pressable>}
    </View>
    {!!error && <Notice text={error} error />}
    {!!notice && <Notice text={notice} />}
    <View style={s.scrollers}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.filters}>
        {[{ id: null, name: "Tất cả" }, ...areas].map(a =>
          <Pressable key={a.id ?? "all"} accessibilityRole="button"
            accessibilityState={{ selected: selectedArea === a.id }}
            onPress={() => onAreaChange(a.id)}
            style={[s.chip, selectedArea === a.id && s.chipSelected]}>
            <Text style={[s.chipText, selectedArea === a.id && s.chipTextSelected]}>
              {a.name}</Text>
          </Pressable>)}
      </ScrollView>
    </View>
    <View style={s.filters}>
      {([
        ["all", "Tất cả"], ["available", "Trống"], ["active", "Có khách"], ["pending", "Chờ duyệt"],
      ] as const).map(([id, label]) =>
        <Pressable key={id} accessibilityRole="button"
          accessibilityState={{ selected: filter === id }}
          onPress={() => onFilterChange(id)} style={[s.filter, filter === id && s.filterSelected]}>
          <Text style={[s.filterText, filter === id && s.filterTextSelected]}>{label}</Text>
        </Pressable>)}
    </View>
    <View style={s.toggle}>
      <Pressable accessibilityRole="button" style={[s.toggleButton, display === "grid" && s.toggleSelected]}
        onPress={() => onDisplayChange("grid")}><Text style={s.toggleText}>▦ Sơ đồ</Text></Pressable>
      <Pressable accessibilityRole="button" style={[s.toggleButton, display === "list" && s.toggleSelected]}
        onPress={() => onDisplayChange("list")}><Text style={s.toggleText}>☷ Danh sách</Text></Pressable>
    </View>
    {loading && !tables.length ? <ActivityIndicator color={c.red} style={{ padding: 32 }} /> :
      !shown.length ? <Notice text="Không có bàn phù hợp. Vào Thiết lập để thêm bàn/khu vực hoặc đổi bộ lọc." /> :
      <View style={s.grid}>{shown.map(table => {
        const session = table.sessions[0];
        const pending = session?._count.tickets ?? 0;
        const area = areas.find(a => a.id === table.areaId);
        const locked = !table.isActive || !area?.isActive;
        const status = locked ? "Tạm khóa" : pending ? "Chờ xác nhận" :
          session?.status === "CHECKOUT" ? "Chờ thanh toán" : session ? "Đang phục vụ" : "Trống";
        const tone = locked ? s.locked : pending ? s.pending : session ? s.occupied : s.free;
        return <Pressable key={table.id} accessibilityRole="button"
          accessibilityLabel={table.name + ", " + status}
          onPress={() => { void inspect(table); }}
          style={[s.table, tone, { width: tileWidth }]}>
          <View style={s.tableTop}>
            <Text style={s.tableCode}>{table.code}</Text>
            {pending > 0 && <View style={s.badge}><Text style={s.badgeText}>{pending}</Text></View>}
          </View>
          <Text style={s.tableName} numberOfLines={2}>{table.name}</Text>
          <Text style={s.area} numberOfLines={1}>{areaName(table.areaId)}</Text>
          <Text style={s.tableStatus}>{status}</Text>
          {session && <Text style={s.area}>Từ {formatDate(session.openedAt)}</Text>}
        </Pressable>;
      })}</View>}
    <Modal transparent animationType="slide" visible={!!selected}
      onRequestClose={() => setSelected(null)}>
      <SafeAreaView style={s.overlay} edges={["top", "bottom"]}>
        <View style={s.sheet}>
          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 13 }}
            keyboardShouldPersistTaps="handled">
            <View style={s.sheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={s.title}>{activeSelected?.name}</Text>
                <Text style={s.sub}>{areaName(activeSelected?.areaId ?? "")} · {activeSelected?.code}</Text>
              </View>
              <Action secondary label="Đóng" onPress={() => setSelected(null)} />
            </View>
            {activeSelected && !activeSelected.sessions.length ? <>
              <Notice text={activeSelected.isActive
                ? "Bàn trống. Nhân viên mở phiên trước khi gọi món hoặc khách quét QR."
                : "Bàn đang bị tạm khóa. Mở khóa ở mục Thiết lập."} />
              {canOpen && activeSelected.isActive &&
                areas.find(a => a.id === activeSelected.areaId)?.isActive &&
                <Action disabled={busy} label="Mở phiên bàn" onPress={() => {
                  void open(activeSelected); setSelected(null);
                }} />}
            </> : activeSelected?.sessions[0] && <>
              <Text style={s.section}>Phiên đang mở · {formatDate(activeSelected.sessions[0].openedAt)}</Text>
              {canBill && (billLoading ? <ActivityIndicator color={c.red} /> :
                bill ? <View style={s.bill}>
                  <View style={s.amountRow}>
                    <Text style={s.detail}>Tạm tính</Text><Text style={s.amount}>{money(bill.subtotalVnd)}</Text>
                  </View>
                  <View style={s.amountRow}>
                    <Text style={s.detail}>Đã thu</Text><Text style={s.detail}>{money(bill.paidVnd)}</Text>
                  </View>
                  <View style={s.amountRow}>
                    <Text style={s.detail}>Còn lại</Text><Text style={s.amount}>{money(bill.dueVnd)}</Text>
                  </View>
                  {bill.tickets.map(t => <View key={t.id} style={s.ticket}>
                    <Text style={s.smallTitle}>Phiếu · {t.status}</Text>
                    {t.items.map(i => <Text key={i.id} style={s.detail}>
                      {i.quantity} × {i.productName} {i.variantName || ""} · {money(i.lineTotalVnd)}</Text>)}
                  </View>)}
                </View> : <Action secondary label="Tải hóa đơn" onPress={() => { void inspect(activeSelected); }} />)}
              {canApprove && pendingForSelected.map(t =>
                <View key={t.id} style={s.ticket}>
                  <Text style={s.smallTitle}>Yêu cầu QR chờ duyệt · {formatDate(t.createdAt)}</Text>
                  {t.items.map(i => <Text key={i.id} style={s.detail}>{i.quantity} × {i.productName}</Text>)}
                  {!!t.customerNote && <Text style={s.detail}>Ghi chú: {t.customerNote}</Text>}
                  <View style={s.actions}>
                    <Action disabled={busy} label="Duyệt món" onPress={() => { void approve(t); }} />
                    <Action dangerous disabled={busy} label="Từ chối"
                      onPress={() => { setRejectTicket(t); setRejectReason(""); setSelected(null); }} />
                  </View>
                </View>)}
              {canOpen && <Action secondary label="Mở Retail để thêm món" onPress={() => openRetail(activeSelected)} />}
              {!canBill && <Notice text="Thông tin thanh toán không hiển thị với vai trò này." />}
            </>}
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
    <Modal visible={!!rejectTicket} transparent animationType="fade"
      onRequestClose={() => { if (!busy) setRejectTicket(null); }}>
      <SafeAreaView style={s.overlay} edges={["top", "bottom"]}>
        <View style={s.sheet}>
          <Text style={s.title}>Từ chối yêu cầu QR?</Text>
          <Text style={s.sub}>Yêu cầu sẽ không chuyển Bếp và không cộng tiền.</Text>
          <Field label="Lý do từ chối" value={rejectReason} onChangeText={setRejectReason}
            placeholder="Ví dụ: Món đã hết" maxLength={500} />
          <View style={s.actions}>
            <Action secondary disabled={busy} label="Quay lại" onPress={() => setRejectTicket(null)} />
            <Action dangerous disabled={busy || rejectReason.trim().length < 3}
              label="Xác nhận từ chối" onPress={() => { void reject(); }} />
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  </View>;
}
const s = StyleSheet.create({
  screen: { padding: 12, gap: 12, paddingBottom: 28 },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 18, color: c.ink, fontWeight: "900" },
  sub: { color: c.secondary, fontSize: 12, lineHeight: 18 },
  refresh: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  refreshText: { fontSize: 25, color: c.red, fontWeight: "800" },
  manage: { minHeight: 44, paddingHorizontal: 12, borderRadius: 8,
    backgroundColor: c.soft, justifyContent: "center" },
  manageText: { color: c.redDeep, fontWeight: "800", fontSize: 12 },
  scrollers: { minHeight: 44 },
  filters: { flexDirection: "row", gap: 7, alignItems: "center", flexWrap: "wrap" },
  chip: { minHeight: 44, paddingHorizontal: 14, justifyContent: "center", borderRadius: 10,
    backgroundColor: c.pale, borderWidth: 1, borderColor: c.line },
  chipSelected: { backgroundColor: c.redDeep, borderColor: c.redDeep },
  chipText: { color: c.ink, fontSize: 12, fontWeight: "700" },
  chipTextSelected: { color: c.white },
  filter: { minHeight: 44, paddingHorizontal: 11, alignItems: "center", justifyContent: "center",
    borderRadius: 10, backgroundColor: c.pale, borderWidth: 1, borderColor: c.line },
  filterSelected: { backgroundColor: "#FDE8E8", borderColor: c.redDeep },
  filterText: { color: c.secondary, fontSize: 11, fontWeight: "700" },
  filterTextSelected: { color: c.redDeep },
  toggle: { flexDirection: "row", alignItems: "center", gap: 7 },
  toggleButton: { minHeight: 44, paddingHorizontal: 13, borderRadius: 9,
    justifyContent: "center", backgroundColor: c.pale, borderWidth: 1, borderColor: c.line },
  toggleSelected: { backgroundColor: "#F9E0D3", borderColor: "#D6B4A3" },
  toggleText: { fontSize: 12, color: c.ink, fontWeight: "800" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  table: { minHeight: 120, justifyContent: "center", padding: 11,
    borderRadius: 12, borderWidth: 1, gap: 4 },
  free: { backgroundColor: "#E9F8F1", borderColor: "#ADDCC7" },
  occupied: { backgroundColor: "#F4E2D6", borderColor: "#D7AC91" },
  pending: { backgroundColor: "#FDE6E4", borderColor: "#E7A19D" },
  locked: { backgroundColor: "#F3F4F6", borderColor: "#E2E4E8" },
  tableTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  tableCode: { fontSize: 16, fontWeight: "900", color: c.ink },
  tableName: { fontSize: 13, fontWeight: "800", color: c.ink },
  area: { fontSize: 11, color: c.secondary },
  tableStatus: { fontSize: 12, color: c.redDeep, fontWeight: "800" },
  badge: { minWidth: 23, minHeight: 23, borderRadius: 12, backgroundColor: c.red,
    alignItems: "center", justifyContent: "center" },
  badgeText: { color: c.white, fontWeight: "800" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center", paddingHorizontal: 10 },
  sheet: { width: "100%", maxWidth: 600, maxHeight: "90%", backgroundColor: c.white,
    padding: 16, borderRadius: 14, alignSelf: "center", gap: 12 },
  sheetHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  section: { color: c.ink, fontSize: 14, fontWeight: "800" },
  bill: { gap: 8, backgroundColor: c.pale, padding: 10, borderRadius: 10 },
  amountRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  amount: { fontSize: 14, fontWeight: "900", color: c.redDeep },
  detail: { fontSize: 12, color: c.ink, lineHeight: 18 },
  ticket: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.line, gap: 7 },
  smallTitle: { color: c.ink, fontSize: 13, fontWeight: "800" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
