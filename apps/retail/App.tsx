import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState, Image, Pressable, ScrollView, StyleSheet,
  Text, TextInput, View, useWindowDimensions,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import {
  api, branchPath, currentSession, money, productImage, restoreSession, setSession,
  type Area, type Bill, type Branch, type CartLine, type Menu, type Principal,
  type Product, type Receipt, type Submission, type Table, type Ticket, type Tokens,
} from "./src/pos-api";
import { cartSelectionLabels, clientKey } from "./src/pos-cart";
import { ProductSheet } from "./src/ProductSheet";
import { RetailTicketCard, ticketGroup } from "./src/RetailTicketCard";
import { RetailSettlementPanel } from "./src/RetailSettlementPanel";
import { watchRetailDining } from "./src/dining-live";
import { playRetailQrAlert } from "./src/dining-alert";
import { loadFrozenTicket, writeFrozenTicket } from "./src/retail-recovery";
import { enableRetailDiningPush } from "./src/dining-push";

const C = { dark: "#302321", muted: "#80716C", red: "#942B35", redDark: "#7B1B26",
  cream: "#FAF7F3", paper: "#FFFFFF", border: "#EAE1DA", soft: "#F5ECE6",
  olive: "#287C5C", paleGreen: "#E7F4EB", amber: "#A65A19", paleAmber: "#FFF0DB" };
type Page = "tables" | "menu" | "bill";
const permitted = ["OWNER", "MANAGER", "WAITER", "CASHIER"];
const canOrder = (role: string) => ["OWNER", "MANAGER", "WAITER"].includes(role);
const hhmm = (text: string) => new Date(text).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });

export default function App() {
  const { width } = useWindowDimensions();
  const desktop = width >= 768;
  const [credential, setCredential] = useState({ username: "", password: "" });
  const [token, setToken] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [staffId, setStaffId] = useState<string | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [areaId, setAreaId] = useState<string | null>(null);
  const [areas, setAreas] = useState<Area[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [catalog, setCatalog] = useState<Menu | null>(null);
  const [approvals, setApprovals] = useState<Ticket[]>([]);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [bill, setBill] = useState<Bill | null>(null);
  const [page, setPage] = useState<Page>("tables");
  const [workspace, setWorkspace] = useState<"pos" | "queue">("pos");
  const [queueTicketId, setQueueTicketId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [toppingOnly, setToppingOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [online, setOnline] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [showBranchMenu, setShowBranchMenu] = useState(false);
  const [pendingSubmit, setPendingSubmit] = useState<{ sessionId: string; payload: Submission } | null>(null);
  const lock = useRef(false);
  const requestVersion = useRef(0);
  const seenPending = useRef(new Set<string>());
  const lastSoundAt = useRef(0);
  const branch = branches.find(b => b.id === branchId) ?? null;
  const role = branch?.staffRole ?? "";
  const activeTable = tables.find(t => t.id === selectedTableId) ?? null;
  const sessionId = activeTable?.sessions[0]?.id ?? null;
  const usableAreas = areas.filter(a => a.isActive);
  const shownTables = tables.filter(t => (!areaId || t.areaId === areaId) &&
    (t.isActive || t.sessions.length > 0 || t.needsCleaning));
  const currentApprovals = approvals.filter(t => t.sessionId === sessionId);
  const queueTicket = approvals.find(t => t.id === queueTicketId) ?? approvals[0] ?? null;
  const queueTable = queueTicket && tables.find(t => t.sessions[0]?.id === queueTicket.sessionId);
  const waitingTickets = bill?.tickets.filter(t => ticketGroup(t.status) === "pending") ?? [];
  const acceptedTickets = bill?.tickets.filter(t => ticketGroup(t.status) === "accepted") ?? [];
  const excludedTickets = bill?.tickets.filter(t => ticketGroup(t.status) === "excluded") ?? [];
  const estimatedVnd = cart.reduce((n, x) => n + x.previewVnd, 0);
  // View models only: these UUIDs remain ModifierOption IDs.
  // Backend persists them as null-product dining ticket lines, never duplicate Products.
  const standaloneProducts = useMemo(() => (catalog?.standaloneToppings ?? []).map(option => ({
    id: option.id, categoryId: "__standalone_topping__", standaloneTopping: true,
    name: option.name, description: option.groupName, imageKey: option.imageKey,
    priceVnd: option.priceVnd, isAvailable: option.isAvailable,
    kind: "STANDARD" as const, variants: [], modifierGroups: [],
    comboGroups: [], comboFixedItems: [],
  })), [catalog]);

  const refresh = useCallback(async (showSpinner = false) => {
    if (!branchId || !currentSession()) return;
    const version = ++requestVersion.current;
    if (showSpinner) setSyncing(true);
    const root = branchPath(branchId);
    try {
      const [a, t, m, q] = await Promise.all([
        api<Area[]>(root + "/areas"), api<Table[]>(root + "/tables"),
        api<Menu>("/catalog/branches/" + branchId),
        canOrder(branches.find(x => x.id === branchId)?.staffRole ?? "")
          ? api<Ticket[]>(root + "/approvals") : Promise.resolve([]),
      ]);
      if (version !== requestVersion.current) return;
      setAreas(a); setTables(t); setCatalog(m); setApprovals(q);
      q.forEach(ticket => seenPending.current.add(ticket.id));
      setOnline(true); setError("");
    } catch (e) {
      if (version === requestVersion.current) {
        setOnline(false); setError(e instanceof Error ? e.message : "Không đồng bộ được bàn.");
      }
    } finally { if (version === requestVersion.current) setSyncing(false); }
  }, [branchId, branches]);

  useEffect(() => {
    if (!token || !branchId) return;
    seenPending.current.clear(); lastSoundAt.current = 0;
    void refresh(true);
    const stop = watchRetailDining(token, branchId, {
      onReady: () => { void refresh(); },
      onChange: hint => {
        if (hint.type === "dining.pending" && hint.ticketId &&
          !seenPending.current.has(hint.ticketId)) {
          seenPending.current.add(hint.ticketId);
          if (Date.now() - lastSoundAt.current > 2500) {
            lastSoundAt.current = Date.now();
            void playRetailQrAlert().catch(() => undefined);
          }
        }
        void refresh();
      },
    });
    const timer = setInterval(() => { if (AppState.currentState === "active") void refresh(); }, 5000);
    const sub = AppState.addEventListener("change", s => {
      if (s === "active") void refresh(true);
    });
    return () => { stop(); clearInterval(timer); sub.remove(); };
  }, [token, branchId, refresh]);

  useEffect(() => {
    if (!token || !branchId || !sessionId) { setBill(null); return; }
    let current = true;
    const load = () => {
      if (!current) return;
      void api<Bill>(branchPath(branchId) + "/sessions/" + sessionId)
        .then(v => { if (current) setBill(v); })
        .catch(() => { if (current) setBill(null); });
    };
    load();
    const timer = setInterval(() => { if (AppState.currentState === "active") load(); }, 5000);
    return () => { current = false; clearInterval(timer); };
  }, [token, branchId, sessionId]);

  const activateStaff = useCallback(async (tokens: Tokens) => {
    setSession(tokens);
    const [person, scoped] = await Promise.all([
      api<Principal>("/auth/me"),
      api<Branch[]>("/admin/orders/branches"),
    ]);
    const allowed = scoped.filter(b => b.isActive && permitted.includes(b.staffRole ?? "")
      && (person.role === "OWNER" || b.staffRole !== "OWNER"));
    if (!allowed.length) {
      throw new Error("Tài khoản không có quyền bán tại quán ở chi nhánh đang hoạt động.");
    }
    const stored = await loadFrozenTicket();
    const recovered = stored && stored.staffId === person.id &&
      allowed.some(b => b.id === stored.branchId) ? stored : null;
    setStaffId(person.id);
    setBranches(allowed);
    setBranchId(recovered?.branchId ?? allowed[0]!.id);
    if (recovered) {
      setSelectedTableId(recovered.tableId);
      setCart(recovered.cart);
      setNote(recovered.note);
      setPendingSubmit({ sessionId: recovered.sessionId, payload: recovered.payload });
      setMessage("Có phiếu chưa rõ kết quả. Vui lòng kiểm tra và gửi lại bằng mã phiếu cũ.");
    }
    setToken(currentSession()?.accessToken ?? tokens.accessToken);
    setCredential(c => ({ ...c, password: "" }));
    setPage(recovered ? "bill" : "tables");
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const existing = await restoreSession();
        if (!existing || cancelled) return;
        await activateStaff(existing);
        if (cancelled) return;
      } catch (cause) {
        if (!cancelled) {
          // Unreachable server is not proof of a revoked session.
          // Keep encrypted credentials available for a later authenticated retry.
          const network = cause instanceof Error && /kết nối|máy chủ/i.test(cause.message);
          if (!network) setSession(null);
          setError(network ? "Không kết nối được máy chủ. Phiên đã lưu vẫn an toàn; thử đăng nhập hoặc mở lại khi có mạng."
            : "Phiên đăng nhập không còn hợp lệ. Vui lòng đăng nhập lại.");
        }
      } finally { if (!cancelled) setRestoring(false); }
    })();
    return () => { cancelled = true; };
  }, [activateStaff]);

  const login = async () => {
    if (lock.current || restoring || !credential.username.trim() || !credential.password) return;
    lock.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const tokens = await api<Tokens>("/auth/login", { method: "POST", anonymous: true,
        body: { username: credential.username.trim(), password: credential.password } });
      await activateStaff(tokens);
    } catch (e) { setSession(null); setError(e instanceof Error ? e.message : "Không đăng nhập được."); }
    finally { lock.current = false; setBusy(false); }
  };
  const logout = () => {
    ++requestVersion.current;
    setSession(null); setToken(null); setStaffId(null); setBranches([]); setBranchId(null); setAreas([]);
    setTables([]); setApprovals([]); setCatalog(null); setSelectedTableId(null);
    setCart([]); setPendingSubmit(null); setBill(null); setMessage(""); setError(""); setPage("tables");
    setWorkspace("pos"); setQueueTicketId(null);
  };
  const branchChange = (value: string) => {
    if (pendingSubmit || cart.length > 0) {
      setError("Bàn đang có giỏ chưa gửi. Hãy hoàn tất hoặc xóa các món trước khi đổi chi nhánh.");
      return;
    }
    if (value === branchId) { setShowBranchMenu(false); return; }
    ++requestVersion.current; setBranchId(value); setAreaId(null); setSelectedTableId(null);
    setTables([]); setCatalog(null); setBill(null); setCart([]); setSearch(""); setCategoryId(null); setToppingOnly(false);
    setPage("tables"); setShowBranchMenu(false); setError(""); setMessage("");
    setWorkspace("pos"); setQueueTicketId(null);
  };
  const doAction = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setMessage("");
    try { await action(); }
    catch (e) { setError(e instanceof Error ? e.message : "Thao tác thất bại."); }
    finally { lock.current = false; setBusy(false); }
  };
  const selectTable = (t: Table) => {
    if (t.id !== selectedTableId && cart.length > 0) {
      setError("Giỏ đang thuộc bàn trước. Hoàn tất hoặc bỏ món trước khi chọn bàn khác.");
      return;
    }
    if (pendingSubmit && pendingSubmit.sessionId !== t.sessions[0]?.id) {
      setError("Hãy xử lý phiếu đang chờ kết quả trước khi đổi bàn."); return;
    }
    setSelectedTableId(t.id); setPage(t.sessions.length ? "menu" : "tables"); setBill(null);
    setWorkspace("pos");
  };
  const openTable = () => {
    if (!branchId || !activeTable || !canOrder(role) || !online || activeTable.needsCleaning) return;
    const b = branchId, id = activeTable.id;
    void doAction(async () => {
      try {
        await api(branchPath(b) + "/tables/" + id + "/sessions", { method: "POST", body: {} });
      } catch (e) {
        await refresh(true);
        throw e;
      }
      await refresh(true);
      setPage("menu"); setMessage("Đã mở phiên bàn. Có thể gọi món.");
    });
  };
  const send = async () => {
    if (!branchId || !sessionId || !staffId || !selectedTableId || !canOrder(role) || !cart.length || !online) return;
    if (pendingSubmit && pendingSubmit.sessionId !== sessionId) {
      setError("Phiếu chưa rõ kết quả thuộc phiên bàn trước. Không thể tạo yêu cầu mới."); return;
    }
    const payload = pendingSubmit?.payload ?? {
      idempotencyKey: clientKey(), customerNote: note.trim(),
      items: cart.map(({ item }) => ({ ...item, modifierIds: [...item.modifierIds],
        comboOptionIds: [...item.comboOptionIds] })),
    };
    const frozen = pendingSubmit ?? { sessionId, payload };
    // Save the exact request before sending. Unknown network failures retain it for safe retry.
    setPendingSubmit(frozen);
    await doAction(async () => {
      // Persist the exact key and request before HTTP: restart must never create a new ticket.
      await writeFrozenTicket({ staffId, branchId, tableId: selectedTableId,
        sessionId: frozen.sessionId, payload: frozen.payload, cart, note });
      const result = await api<Receipt>(branchPath(branchId) + "/sessions/" + frozen.sessionId + "/tickets",
        { method: "POST", body: frozen.payload });
      await writeFrozenTicket(null);
      setPendingSubmit(null); setCart([]); setNote(""); setPage("bill");
      setMessage(result.replayed ? "Phiếu đã được ghi nhận trước đó, không tạo lại." : "Đã gửi món xuống Bếp.");
      await refresh(true);
      try {
        setBill(await api<Bill>(branchPath(branchId) + "/sessions/" + frozen.sessionId));
      } catch {
        // Ticket is already committed. A failed read MUST NOT turn success into a retry prompt.
        setMessage("Đã ghi nhận phiếu. Hóa đơn tạm chưa đồng bộ; bấm làm mới khi có mạng.");
      }
    });
  };
  const review = (ticketId: string, decision: "approve" | "reject") => {
    if (!branchId || !canOrder(role) || !online) return;
    if (decision === "reject" && rejectReason.trim().length < 3) {
      setError("Nhập lý do từ chối tối thiểu 3 ký tự."); return;
    }
    void doAction(async () => {
      await api(branchPath(branchId) + "/tickets/" + ticketId + "/" + decision,
        { method: "POST", ...(decision === "reject" ? { body: { reason: rejectReason.trim() } } : {}) });
      setRejecting(null); setRejectReason(""); setQueueTicketId(null);
      setMessage(decision === "approve" ? "Đã duyệt; phiếu sẽ hiện ở Bếp đúng một lần." : "Đã từ chối yêu cầu QR.");
      await refresh(true);
      if (sessionId) {
        try { setBill(await api<Bill>(branchPath(branchId) + "/sessions/" + sessionId)); }
        catch { setMessage("Đã xử lý phiếu QR. Hóa đơn sẽ cập nhật ở lần đồng bộ sau."); }
      }
    });
  };
  const productPhotos = useMemo(() => {
    const photos = new Map<string, string>();
    for (const group of catalog?.categories ?? []) for (const product of group.products) {
      const imageUrl = productImage(product.imageKey);
      if (imageUrl) photos.set(product.id, imageUrl);
    }
    for (const topping of catalog?.standaloneToppings ?? []) {
      const imageUrl = productImage(topping.imageKey);
      if (imageUrl) photos.set(topping.id, imageUrl);
    }
    return photos;
  }, [catalog]);
  const products = useMemo(() => (
    toppingOnly ? standaloneProducts : (catalog?.categories ?? []).flatMap(c =>
      c.products.map(p => ({ ...p, categoryId: c.id })))
  ).filter(p => (toppingOnly || !categoryId || p.categoryId === categoryId) &&
    (!search.trim() || (p.name + " " + (p.description ?? "")).toLocaleLowerCase("vi")
      .includes(search.toLocaleLowerCase("vi").trim()))),
    [catalog, categoryId, search, toppingOnly, standaloneProducts]);
  const removeLine = (id: string) => {
    if (pendingSubmit) return;
    setCart(c => c.filter(x => x.id !== id));
  };

  // A single compact desktop worktop: area filters and the live table strip
  // share one row so the menu and invoice keep the useful viewport height.
  const areaFilters = <ScrollView horizontal showsHorizontalScrollIndicator={false}
    style={desktop ? st.areaScroll : undefined} contentContainerStyle={st.chips}>
    <Chip label="Tất cả" active={!areaId} onPress={() => setAreaId(null)}/>
    {usableAreas.map(a => <Chip key={a.id} label={a.name} active={areaId === a.id}
      onPress={() => setAreaId(a.id)}/>)}
  </ScrollView>;
  const tableStrip = <View testID="retail-table-strip" style={st.tableSection}>
    {desktop ? <View style={st.desktopTableRow}>
      <View style={st.desktopAreaWrap}>
        <Text style={st.tableMiniLabel}>KHU VỰC</Text>
        {areaFilters}
      </View>
      <View style={st.desktopTableWrap}>
        <Text style={st.tableMiniLabel}>BÀN · {tables.filter(t => t.sessions.length > 0).length} ĐANG PHỤC VỤ</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          style={st.tableScroll} contentContainerStyle={st.chips}>
          {shownTables.map(t => {
            const active = !!t.sessions.length;
            const waiting = t.sessions[0]?._count.tickets ?? 0;
            return <Pressable key={t.id} accessibilityRole="button"
              accessibilityLabel={t.name + (waiting ? ", chờ duyệt " + waiting : active ? ", đang có khách" : t.needsCleaning ? ", chờ dọn" : ", trống")}
              onPress={() => selectTable(t)} style={[st.tableChip,
                waiting > 0 ? st.tablePending : active ? st.tableOpen : t.needsCleaning ? st.tableDirty : st.tableFree,
                selectedTableId === t.id && st.tableSelected]}>
              <Text style={[st.tableCode, selectedTableId === t.id && st.selectedText]}>{t.code}</Text>
              <Text numberOfLines={1} style={[st.tableState, selectedTableId === t.id && st.selectedText]}>
                {waiting ? waiting + " chờ xác nhận" : active ? "Đang phục vụ" : t.needsCleaning ? "Chờ dọn" : "Trống"}
              </Text>
            </Pressable>;
          })}
          {!shownTables.length && <Text style={st.caption}>Khu vực chưa có bàn.</Text>}
        </ScrollView>
      </View>
    </View> : <>
      <View style={st.sectionHead}>
        <Text style={st.sectionTitle}>Khu vực & bàn</Text>
        <Text style={st.caption}>{tables.filter(t => t.sessions.length > 0).length} đang phục vụ</Text>
      </View>
      {areaFilters}
    </>}
  </View>;

  const reviewActions = (ticket: Ticket) => canOrder(role) && ticket.status === "PENDING_APPROVAL" ?
    <View style={st.reviewActions}>
      {rejecting === ticket.id ? <>
        <TextInput style={st.input} value={rejectReason} maxLength={500}
          onChangeText={setRejectReason} placeholder="Lý do từ chối (ít nhất 3 ký tự)"
          accessibilityLabel="Lý do từ chối"/>
        <View style={st.row}>
          <Button title="Quay lại" kind="ghost" onPress={() => { setRejecting(null); setRejectReason(""); }}/>
          <Button title="Xác nhận từ chối" danger disabled={busy || !online || rejectReason.trim().length < 3}
            onPress={() => review(ticket.id, "reject")}/>
        </View>
      </> : <View style={st.row}>
        <Button title="Duyệt đưa Bếp" disabled={busy || !online} onPress={() => review(ticket.id, "approve")}/>
        <Button title="Từ chối" kind="ghost" disabled={busy || !online}
          onPress={() => { setRejecting(ticket.id); setRejectReason(""); }}/>
      </View>}
    </View> : null;

  const queuePanel = <View testID="retail-qr-queue" style={st.queueLayout}>
    <View style={st.queueSidebar}>
      <View style={st.queueHeading}>
        <Text style={st.sectionTitle}>Yêu cầu chờ xác nhận</Text>
        <Text style={st.queueBadge}>{approvals.length}</Text>
      </View>
      <ScrollView contentContainerStyle={st.queueRows} keyboardShouldPersistTaps="handled">
        {!online && <Text style={st.warning}>Đang mất kết nối. Không thể duyệt yêu cầu.</Text>}
        {!approvals.length && <View style={st.queueEmpty}>
          <Text style={st.emptyTitle}>Không có yêu cầu chờ</Text>
          <Text style={st.caption}>Yêu cầu QR mới của chi nhánh sẽ hiện ở đây.</Text>
        </View>}
        {approvals.map(t => <Pressable key={t.id} accessibilityRole="button"
          accessibilityLabel={"Xem phiếu QR " + (t.session?.table.name ?? "không xác định")}
          accessibilityState={{ selected: queueTicket?.id === t.id }}
          onPress={() => { setQueueTicketId(t.id); setRejecting(null); setRejectReason(""); }}
          style={[st.queueRow, queueTicket?.id === t.id && st.queueRowActive]}>
          <View style={st.rowBetween}>
            <Text style={st.queueTableName}>{t.session?.table.name ?? "Bàn"}</Text>
            <Text style={st.queueBadgeSmall}>{t.items.reduce((n, i) => n + i.quantity, 0)} món</Text>
          </View>
          <Text style={st.caption}>QR · {hhmm(t.createdAt)}</Text>
          <Text numberOfLines={2} style={st.itemText}>{t.items.map(i => i.quantity + " × " + i.productName).join(" · ")}</Text>
        </Pressable>)}
      </ScrollView>
    </View>
    <View style={st.queueDetails}>
      {queueTicket ? <ScrollView keyboardShouldPersistTaps="handled"
        contentContainerStyle={st.queueDetailScroll}>
        <View style={st.rowBetween}>
          <View style={{ flex: 1 }}>
            <Text style={st.sectionTitle}>Chi tiết {queueTable?.name ?? queueTicket.session?.table.name ?? "bàn"}</Text>
            <Text style={st.caption}>Nhân viên xác nhận trước khi Bếp nhận món.</Text>
          </View>
          {queueTable && <Button title="Mở hóa đơn" kind="ghost" onPress={() => {
            selectTable(queueTable); setPage("bill");
          }}/>} 
        </View>
        <RetailTicketCard ticket={queueTicket} catalog={catalog} actions={reviewActions(queueTicket)}/>
      </ScrollView> : <View style={st.queueDetailEmpty}>
        <Text style={st.emptyTitle}>Chưa có phiếu cần xử lý</Text>
        <Text style={st.caption}>Khi khách gửi yêu cầu qua QR, chọn bàn ở danh sách bên trái để xem món.</Text>
      </View>}
    </View>
  </View>;

  const ticketPanel = <View style={st.billPanel}>
    <View style={st.sectionHead}><View style={{ flex: 1 }}>
      <Text style={st.sectionTitle}>Hóa đơn {activeTable?.name ?? "—"}</Text>
      <Text style={st.caption}>{sessionId ? "Phiên đang mở" : "Chọn bàn để bắt đầu"}</Text>
    </View><Text style={st.caption}>{online ? "● Đồng bộ" : "○ Mất kết nối"}</Text></View>
    {!sessionId ? <View style={st.empty}>
      <Text style={st.emptyTitle}>{activeTable ? "Bàn chưa có phiên" : "Chưa chọn bàn"}</Text>
      <Text style={st.caption}>Chọn một bàn trong danh sách. Nhân viên phải mở phiên trước khi gọi món.</Text>
      {activeTable && canOrder(role) && <Button title="Mở phiên bàn" disabled={busy || !online} onPress={openTable}/>}
    </View> : <>
      {!bill && <Text style={st.caption}>Đang đồng bộ hóa đơn từ máy chủ…</Text>}
      {!!waitingTickets.length && <View testID="retail-bill-pending" style={st.ticketGroupPending}>
        <Text style={st.groupPendingHeading}>Chờ xác nhận ({waitingTickets.reduce((n, t) => n + t.items.length, 0)})</Text>
        {waitingTickets.map(t => <RetailTicketCard key={t.id} ticket={t} catalog={catalog}
          actions={t.source === "QR" ? reviewActions(t) : null}/>)}
      </View>}
      <View testID="retail-bill-accepted" style={st.ticketGroup}>
        <Text style={st.groupAcceptedHeading}>Món đã xác nhận ({acceptedTickets.reduce((n, t) => n + t.items.length, 0)})</Text>
        {acceptedTickets.length ? acceptedTickets.map(t =>
          <RetailTicketCard key={t.id} ticket={t} catalog={catalog}/>) :
          <Text style={st.caption}>Chưa có món được xác nhận. Chọn món từ thực đơn hoặc duyệt phiếu QR.</Text>}
      </View>
      {!!excludedTickets.length && <View testID="retail-bill-excluded" style={st.ticketGroup}>
        <Text style={st.subhead}>Đã từ chối / hủy ({excludedTickets.length} phiếu)</Text>
        {excludedTickets.map(t => <RetailTicketCard key={t.id} ticket={t} catalog={catalog}/>)}
      </View>}
      <Text style={st.subhead}>Món chuẩn bị gửi</Text>
      {!cart.length ? <Text style={st.caption}>Chưa chọn món trong giỏ.</Text> :
        cart.map(l => <View key={l.id} style={st.draftLine}>
          {productPhotos.has(l.item.productId) ?
            <Image source={{ uri: productPhotos.get(l.item.productId)! }}
              style={st.draftPhoto} resizeMode="cover"/> :
            <View style={st.draftPhotoEmpty}><Text>🍲</Text></View>}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={st.itemText}>{l.item.quantity} × {l.name} {l.variantName ? "· " + l.variantName : ""}</Text>
            {cartSelectionLabels(catalog?.categories.flatMap(g => g.products)
              .find(p => p.id === l.item.productId), l.item).map((detail, index) =>
              <Text key={index} style={st.detailLine}>{detail}</Text>)}
            <Text style={st.caption}>{money(l.previewVnd)} · tạm tính</Text>
            {!!l.item.note && <Text style={st.caption}>{l.item.note}</Text>}
          </View>
          <Pressable disabled={!!pendingSubmit || busy} accessibilityRole="button"
            accessibilityLabel={"Bỏ " + l.name} style={st.remove}
            onPress={() => removeLine(l.id)}><Text style={st.removeText}>✕</Text></Pressable>
        </View>)}
      {!!cart.length && <TextInput style={[st.input, st.orderNote]} placeholder="Ghi chú chung cho bếp"
        placeholderTextColor="#9D8C84" value={note} maxLength={500}
        editable={!pendingSubmit} onChangeText={setNote} accessibilityLabel="Ghi chú đơn tại bàn"/>}
      <View style={st.totals}>
        <View style={st.rowBetween}><Text style={st.caption}>Món đã xác nhận</Text>
          <Text style={st.itemText}>{money(bill?.subtotalVnd ?? 0)}</Text></View>
        <View style={st.rowBetween}><Text style={st.caption}>Đã thu</Text>
          <Text style={st.itemText}>{money(bill?.paidVnd ?? 0)}</Text></View>
        <View style={st.rowBetween}><Text style={st.caption}>Còn thanh toán</Text>
          <Text style={st.amount}>{money(bill?.dueVnd ?? 0)}</Text></View>
        <View style={st.rowBetween}><Text style={st.caption}>Giỏ chưa gửi · tạm tính</Text>
          <Text style={st.amount}>{money(estimatedVnd)}</Text></View>
        <Text style={st.micro}>Số tiền chốt trên máy chủ. Yêu cầu QR chưa duyệt không tính vào khoản thu.</Text>
        {canOrder(role) && <Button title={busy ? "Đang gửi…" :
            pendingSubmit ? "Thử gửi lại phiếu cũ" : "Xác nhận & gửi Bếp"}
          disabled={busy || !online || !cart.length} onPress={() => { void send(); }} />}
        {!canOrder(role) && <Text style={st.caption}>Vai trò thu ngân chỉ xem hóa đơn, không gọi món.</Text>}
        {!!pendingSubmit && <Text style={st.warning}>Chưa xác nhận kết quả gửi. Giỏ đã khóa; hãy thử lại bằng cùng mã để tránh tạo món trùng.</Text>}
      </View>
      {branchId && activeTable && <RetailSettlementPanel key={sessionId}
        branchId={branchId} sessionId={sessionId} table={activeTable} tables={tables}
        role={role} bill={bill} onChanged={async () => {
          await refresh(true);
          try { setBill(await api<Bill>(branchPath(branchId) + "/sessions/" + sessionId)); }
          catch { setMessage("Thao tác đã ghi nhận. Hóa đơn đồng bộ lại khi có kết nối."); }
        }}/>}
    </>}
  </View>;

  const menuPanel = <View style={st.menuPanel}>
    <View style={st.sectionHead}><View>
      <Text style={st.sectionTitle}>Thực đơn</Text>
      <Text style={st.caption}>Chọn món cho bàn · giá chốt tại quán</Text>
    </View><Text style={st.caption}>{products.length} món</Text></View>
    <TextInput style={st.input} placeholder="Tìm lẩu, trà sữa, combo, topping…"
      placeholderTextColor="#978984" value={search} onChangeText={setSearch}
      accessibilityLabel="Tìm món"/>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.chips}>
      <Chip label="Tất cả" active={!categoryId && !toppingOnly}
        onPress={() => { setCategoryId(null); setToppingOnly(false); }}/>
      <Chip label="🥬 Gọi topping lẻ" active={toppingOnly} onPress={() => {
        setToppingOnly(value => !value); setCategoryId(null); setSearch("");
      }}/>
      {(catalog?.categories ?? []).map(c => <Chip key={c.id} label={c.name}
        active={!toppingOnly && categoryId === c.id}
        onPress={() => { setCategoryId(c.id); setToppingOnly(false); }}/>)}
    </ScrollView>
    {toppingOnly && !standaloneProducts.length &&
      <Text style={st.warning}>Chưa bật gọi lẻ cho nhóm topping nào.
        Vào Admin → Thư viện nhóm tùy chọn → bật “Cho phép gọi topping lẻ tại bàn” cho nhóm thực phẩm.</Text>}
    {!catalog ? <Text style={st.caption}>Đang tải thực đơn…</Text> :
      products.length === 0 ? <Text style={st.caption}>Không tìm thấy món phù hợp.</Text> :
        <View style={st.products}>{products.map(p => {
          const image = productImage(p.imageKey);
          return <Pressable key={p.id} accessibilityRole="button"
            accessibilityLabel={"Chọn " + p.name} disabled={!p.isAvailable || !sessionId || !canOrder(role) ||
              !!pendingSubmit || busy || !online}
            onPress={() => setSelectedProduct(p)} style={[st.product, desktop && width >= 1024 && st.productTablet,
              desktop && width >= 1200 && st.productWide, !p.isAvailable && st.faded]}>
            {image ? <Image source={{ uri: image }} style={st.productPhoto} resizeMode="cover"/> :
              <View style={st.productEmpty}><Text style={st.productPlaceholder}>LẨU TỨ XUYÊN</Text></View>}
            <View style={st.productBody}>
              <Text style={st.productName} numberOfLines={2}>{p.name}</Text>
              <Text style={st.productPrice}>{money(p.priceVnd)}</Text>
              <Text style={st.caption}>{!p.isAvailable ? "Tạm hết hàng" :
                !sessionId ? "Mở bàn để chọn" : p.kind === "COMBO" ? "Chọn combo" : "Chọn món +"}</Text>
            </View>
          </Pressable>;
        })}</View>}
  </View>;

  return <SafeAreaProvider><SafeAreaView style={st.safe} edges={["top", "bottom"]}>
    {!token ? <View style={st.loginScreen}>
      <View style={st.loginCard}>
        <Text style={st.brand}>LẨU TỨ XUYÊN</Text>
        <Text style={st.loginTitle}>Bán tại quán</Text>
        <Text style={st.caption}>Đăng nhập bằng tài khoản nhân viên đã được phân quyền.</Text>
        <TextInput style={st.input} autoCapitalize="none" value={credential.username}
          onChangeText={username => setCredential(c => ({ ...c, username }))}
          placeholder="Tài khoản nhân viên" accessibilityLabel="Tài khoản nhân viên"/>
        <TextInput style={st.input} secureTextEntry value={credential.password}
          onChangeText={password => setCredential(c => ({ ...c, password }))}
          placeholder="Mật khẩu" accessibilityLabel="Mật khẩu"
          onSubmitEditing={() => { void login(); }}/>
        {!!error && <Text accessibilityRole="alert" style={st.warning}>{error}</Text>}
        <Button title={restoring ? "Đang khôi phục phiên…" : busy ? "Đang xác thực…" : "Đăng nhập"} disabled={busy || restoring}
          onPress={() => { void login(); }}/>
        <Text style={st.micro}>Chỉ nhân viên có quyền mới được xem bàn, gọi món và duyệt QR.</Text>
      </View>
    </View> : <>
      <View style={st.header}>
        <View style={desktop ? st.headerBrandDesktop : st.headerBrandMobile}>
          <Text style={st.brand} numberOfLines={1}>LẨU TỨ XUYÊN & TRÀ SỮA</Text>
          <Pressable accessibilityRole="button" onPress={() => setShowBranchMenu(v => !v)}
            style={st.branchButton}><Text style={st.branchName} numberOfLines={1}>
              {branch?.name ?? "Chọn chi nhánh"} ▾</Text></Pressable>
        </View>
      <ScrollView testID="retail-header-actions" horizontal showsHorizontalScrollIndicator={false}
        style={st.qrToolbar} contentContainerStyle={st.qrToolbarContent}>
        {canOrder(role) && desktop && <View style={st.workspaceTabs}>
          <Pressable accessibilityRole="button" accessibilityState={{ selected: workspace === "pos" }}
            style={[st.workspaceTab, workspace === "pos" && st.workspaceTabActive]}
            onPress={() => setWorkspace("pos")}>
            <Text style={[st.workspaceTabText, workspace === "pos" && st.workspaceTabTextActive]}>Bàn & Món</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityState={{ selected: workspace === "queue" }}
            style={[st.workspaceTab, workspace === "queue" && st.workspaceTabActive]}
            onPress={() => setWorkspace("queue")}>
            <Text style={[st.workspaceTabText, workspace === "queue" && st.workspaceTabTextActive]}>Duyệt QR ({approvals.length})</Text>
          </Pressable>
        </View>}
          {canOrder(role) && <Pressable accessibilityRole="button"
            accessibilityLabel={"Chuông QR, " + approvals.length + " yêu cầu chờ duyệt"}
            style={st.iconButton} onPress={() => {
              const pending = approvals[0];
              const table = pending && tables.find(t => t.sessions[0]?.id === pending.sessionId);
              if (desktop) { setQueueTicketId(pending?.id ?? null); setWorkspace("queue"); }
              else if (table) { selectTable(table); setPage("bill"); }
              else { setAreaId(null); setPage("tables"); }
            }}>
            <Text style={st.iconText}>🔔 {approvals.length}</Text>
          </Pressable>}
          <Pressable accessibilityRole="button" accessibilityLabel="Test thông báo và âm QR"
            style={st.iconButton} onPress={() => {
              void playRetailQrAlert(true).then(() => {
                setMessage("Đã phát thử chuông QR cục bộ. Không tạo đơn hay phiếu.");
              }).catch(cause => setError(cause instanceof Error ? cause.message : "Không phát được âm thử."));
            }}><Text style={st.iconText}>♫</Text></Pressable>
          {canOrder(role) && branchId && <Pressable accessibilityRole="button"
            accessibilityLabel="Bật thông báo QR khi Retail chạy nền"
            style={st.iconButton} onPress={() => {
              void enableRetailDiningPush(branchId)
                .then(() => setMessage("Đã đăng ký Web Push cho chi nhánh này. Trình duyệt quyết định thời điểm phát âm khi chạy nền."))
                .catch(cause => setError(cause instanceof Error ? cause.message : "Không bật được Web Push."));
            }}><Text style={st.iconText}>♧</Text></Pressable>}
          <Pressable accessibilityRole="button" accessibilityLabel="Đồng bộ lại"
            style={st.iconButton} onPress={() => { void refresh(true); }}>
            <Text style={st.iconText}>{syncing ? "…" : "↻"}</Text></Pressable>
      </ScrollView>
        <View style={st.headerRight}>
          <Text style={[st.connectionLabel, { color: online ? "#C4F2D5" : "#FFE3B2" }]}>
            {online ? "● Online" : "○ Mất mạng"}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Đăng xuất"
            style={st.exit} onPress={logout}><Text style={st.exitText}>Thoát</Text></Pressable>
        </View>
      </View>

      {showBranchMenu && <View style={st.branchPicker}>{branches.map(b => <Pressable key={b.id}
        accessibilityRole="button" onPress={() => branchChange(b.id)} style={st.branchItem}>
        <Text style={st.itemText}>{b.name} · {b.staffRole}</Text></Pressable>)}</View>}
      {!!error && <View style={st.alert}><Text accessibilityRole="alert" style={st.warning}>{error}</Text>
        <Pressable accessibilityRole="button" onPress={() => setError("")}><Text style={st.caption}>Đóng ×</Text></Pressable></View>}
      {!!message && <View style={st.success}><Text style={st.successText}>{message}</Text>
        <Pressable accessibilityRole="button" onPress={() => setMessage("")}><Text style={st.caption}>×</Text></Pressable></View>}
      {desktop ? workspace === "queue" && canOrder(role) ? queuePanel : <>
        {tableStrip}
        <View style={st.desktop}>
          <ScrollView testID="retail-desk-order" style={st.leftScroll} contentContainerStyle={st.panelContent}
            keyboardShouldPersistTaps="handled">{ticketPanel}</ScrollView>
          <ScrollView testID="retail-desk-menu" style={st.rightScroll} contentContainerStyle={st.panelContent}
            keyboardShouldPersistTaps="handled">{menuPanel}</ScrollView>
        </View>
      </> : <>
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 30 }}>
          {page === "tables" ? <>
            <View style={st.mobileIntro}><Text style={st.sectionTitle}>Bàn đang phục vụ</Text>
              <Text style={st.caption}>Chạm bàn để xem món, mở phiên hoặc thanh toán.</Text></View>
            {tableStrip}
            <View style={st.tableGrid}>{shownTables.map(t => {
              const count = t.sessions[0]?._count.tickets ?? 0;
              return <Pressable key={t.id} accessibilityRole="button"
                accessibilityLabel={t.name + (count ? ", chờ duyệt " + count :
                  t.sessions.length ? ", đang có khách" : t.needsCleaning ? ", chờ dọn" : ", trống")}
                accessibilityState={{ selected: selectedTableId === t.id }}
                onPress={() => selectTable(t)}
                style={[st.tableTile, count > 0 ? st.pendingTile : t.sessions.length ? st.openTile : t.needsCleaning ? st.pendingTile : st.freeTile,
                  selectedTableId === t.id && st.mobileTileSelected]}>
                <Text style={st.tableCode}>{t.code}</Text><Text style={st.itemText}>{t.name}</Text>
                <Text style={st.caption}>{count ? "🔔 " + count + " chờ duyệt" :
                  t.sessions.length ? "Đang có khách" : t.needsCleaning ? "Chờ dọn" : "Trống"}</Text>
              </Pressable>;
            })}</View>
            {activeTable && !sessionId && canOrder(role) && <View style={st.mobileAction}>
              <Text style={st.sectionTitle}>{activeTable.name}</Text>
              {activeTable.needsCleaning ? <>
                <Text style={st.warning}>Bàn chờ dọn, chưa nhận lượt khách mới.</Text>
                <Button title="Đã dọn bàn" disabled={busy || !online}
                  onPress={() => { if (!branchId) return; void doAction(async () => {
                    await api(branchPath(branchId) + "/tables/" + activeTable.id + "/clean",
                      { method: "POST" });
                    await refresh(true); setMessage("Đã dọn bàn, sẵn sàng nhận khách.");
                  }); }}/>
              </> : <Button title="Mở phiên bàn" disabled={busy || !online} onPress={openTable}/>}
            </View>}
          </> : page === "menu" ? <>
            <View style={st.mobileSelected}><Text style={st.label}>{activeTable?.name ?? "Chọn bàn"}</Text>
              <Button title="Đổi bàn" kind="ghost" onPress={() => setPage("tables")}/></View>
            {currentApprovals.length > 0 && <View style={st.approvals}>
              <Pressable accessibilityRole="button" onPress={() => setPage("bill")}>
                <Text style={st.warning}>🔔 {currentApprovals.length} yêu cầu QR đang chờ → Mở hóa đơn</Text>
              </Pressable></View>}
            {menuPanel}
          </> : <>
            <View style={st.mobileSelected}><Text style={st.label}>{activeTable?.name ?? "Chưa chọn bàn"}</Text>
              <Button title="Chọn món" kind="ghost" onPress={() => setPage("menu")}/></View>
            {ticketPanel}
          </>}
        </ScrollView>
        {page === "menu" && sessionId && cart.length > 0 && <View style={st.mobileCartBar}>
          <View style={{ flex: 1 }}>
            <Text style={st.label}>{cart.length} món trong giỏ bàn</Text>
            <Text style={st.caption}>{money(estimatedVnd)} · chưa gửi Bếp</Text>
          </View>
          <Button title="Xem hóa đơn" onPress={() => setPage("bill")}/>
        </View>}
        {sessionId && <View style={st.mobileNav}>
          {([["tables", "Bàn"], ["menu", "Chọn món"], ["bill", "Hóa đơn"]] as const).map(([id, name]) =>
            <Pressable key={id} accessibilityRole="tab" accessibilityState={{ selected: page === id }}
              onPress={() => setPage(id)} style={[st.mobileTab, page === id && st.mobileTabOn]}>
              <Text style={[st.mobileTabText, page === id && st.mobileTabTextOn]}>
                {name}{id === "bill" && cart.length ? " (" + cart.length + ")" : ""}</Text>
            </Pressable>)}
        </View>}
      </>}
    </>}
    {selectedProduct && <ProductSheet key={selectedProduct.id} product={selectedProduct}
      onClose={() => setSelectedProduct(null)}
      onAdd={line => { setCart(c => [...c, line]); setSelectedProduct(null); setMessage("Đã thêm món vào giỏ bàn."); }}/>}
  </SafeAreaView></SafeAreaProvider>;
}
function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected: active }}
    style={[st.chip, active && st.chipOn]} onPress={onPress}>
    <Text style={[st.chipText, active && st.chipTextOn]}>{label}</Text></Pressable>;
}
function Button({ title, onPress, disabled, danger, kind }: {
  title: string; onPress: () => void; disabled?: boolean; danger?: boolean; kind?: "ghost";
}) {
  return <Pressable accessibilityRole="button" disabled={disabled}
    accessibilityState={{ disabled: !!disabled }} onPress={onPress}
    style={[st.button, kind === "ghost" && st.ghost, danger && st.danger, disabled && st.disabled]}>
    <Text style={[st.buttonText, kind === "ghost" && st.ghostText]}>{title}</Text></Pressable>;
}
const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.cream },
  header: { minHeight: 58, paddingHorizontal: 14, paddingVertical: 5, backgroundColor: "#721419",
    borderBottomWidth: 1, borderColor: "#9B343A", flexDirection: "row", alignItems: "center", gap: 8 },
  brand: { fontSize: 11, letterSpacing: 0.7, color: "#FFE7D7", fontWeight: "900" },
  branchButton: { minHeight: 28, justifyContent: "center" },
  branchName: { fontSize: 14, fontWeight: "800", color: "#FFFFFF" },
  headerBrandDesktop: { width: 196, flexShrink: 1, minWidth: 100 },
  headerBrandMobile: { width: 110, flexShrink: 1, minWidth: 70 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 3, flexShrink: 0 },
  connectionLabel: { fontSize: 11, fontWeight: "800" },
  // A single red command bar; buttons scroll on narrow devices rather than
  // expanding the viewport or hiding touch controls behind another toolbar.
  qrToolbar: { flex: 1, minWidth: 0 },
  qrToolbarContent: { flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 4 },
  iconButton: { minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center",
    backgroundColor: "#873039", borderRadius: 9 },
  iconText: { fontSize: 18, color: "#FFFFFF" },
  exit: { minHeight: 44, paddingHorizontal: 10, justifyContent: "center" },
  exitText: { color: "#FFFFFF", fontWeight: "800", fontSize: 12 },
  branchPicker: { position: "absolute", zIndex: 90, top: 58, left: 12, minWidth: 230,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.paper,
    borderRadius: 12, padding: 6, elevation: 8 },
  branchItem: { minHeight: 44, paddingHorizontal: 13, justifyContent: "center" },
  alert: { flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "#FFEAEA" },
  warning: { color: C.redDark, fontSize: 13, flexShrink: 1, lineHeight: 19 },
  success: { flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 14, paddingVertical: 8, backgroundColor: C.paleGreen },
  successText: { color: C.olive, fontSize: 13, fontWeight: "700", flex: 1 },
  desktop: { flex: 1, flexDirection: "row", padding: 10, gap: 10, minHeight: 0, minWidth: 0 },
  // Web flexbox defaults min-width:auto on scroll containers; minWidth:0 keeps the
  // 38/62 split even when bills, category chips, or product images are very wide.
  leftScroll: { width: "38%", flexGrow: 0, flexShrink: 0, minWidth: 0,
    backgroundColor: C.paper, borderRadius: 14,
    borderWidth: 1, borderColor: C.border },
  rightScroll: { flex: 1, minWidth: 0, backgroundColor: C.paper, borderRadius: 14,
    borderWidth: 1, borderColor: C.border },
  panelContent: { padding: 12, paddingBottom: 32 },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  sectionTitle: { fontSize: 16, color: C.dark, fontWeight: "800" },
  caption: { fontSize: 12, lineHeight: 18, color: C.muted },
  tableSection: { paddingHorizontal: 12, paddingVertical: 8, gap: 7,
    backgroundColor: "#FFFDFB", borderBottomWidth: 1, borderColor: C.border },
  desktopTableRow: { flexDirection: "row", alignItems: "stretch", gap: 12, minWidth: 0 },
  desktopAreaWrap: { width: "30%", flexShrink: 0, gap: 3, minWidth: 0 },
  desktopTableWrap: { flex: 1, minWidth: 0, gap: 3 },
  tableMiniLabel: { fontSize: 10, fontWeight: "900", letterSpacing: 0.5, color: C.muted },
  areaScroll: { minWidth: 0 },
  tableScroll: { minWidth: 0 },
  chips: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 1 },
  chip: { minHeight: 44, justifyContent: "center", borderRadius: 9, borderWidth: 1,
    borderColor: C.border, paddingHorizontal: 12, backgroundColor: C.paper },
  chipOn: { borderColor: C.red, backgroundColor: "#FCE8E8" },
  chipText: { fontSize: 12, fontWeight: "700", color: C.dark },
  chipTextOn: { color: C.red },
  tableChip: { minWidth: 104, minHeight: 52, maxWidth: 140, paddingHorizontal: 10, paddingVertical: 6,
    borderColor: C.border, borderWidth: 1, borderRadius: 9, gap: 2, justifyContent: "center" },
  tableFree: { backgroundColor: "#E7F4EB", borderColor: "#C5E2D2" },
  tableOpen: { backgroundColor: "#FFF0DB", borderColor: "#ECC8A2" },
  tableDirty: { backgroundColor: "#FEF0CF", borderColor: "#EAD09B" },
  tablePending: { backgroundColor: "#FFE6E4", borderColor: "#EA8A88" },
  tableSelected: { backgroundColor: "#922530", borderColor: "#922530" },
  tableCode: { fontWeight: "900", fontSize: 15, color: C.dark },
  tableState: { color: C.muted, fontSize: 10, fontWeight: "700" },
  selectedText: { color: "#FFFFFF" },
  billPanel: { gap: 11 },
  menuPanel: { gap: 11 },
  empty: { borderStyle: "dashed", borderWidth: 1, borderColor: C.border,
    borderRadius: 12, padding: 22, alignItems: "center", gap: 10 },
  emptyTitle: { fontWeight: "800", fontSize: 15, color: C.dark },
  approvals: { gap: 10, backgroundColor: C.paleAmber, borderRadius: 12, padding: 12 },
  approvalCard: { backgroundColor: C.paper, borderRadius: 10, padding: 10, gap: 8 },
  label: { color: C.dark, fontWeight: "800", fontSize: 13 },
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", gap: 10, alignItems: "center" },
  subhead: { fontSize: 14, fontWeight: "800", color: C.dark, marginTop: 8 },
  ticket: { paddingVertical: 10, borderBottomWidth: 1, borderColor: C.border, gap: 7 },
  ticketHead: { fontSize: 12, color: C.dark, fontWeight: "800", flexShrink: 1 },
  status: { fontSize: 12, color: C.red, fontWeight: "700" },
  itemText: { fontSize: 13, lineHeight: 20, color: C.dark },
  draftLine: { flexDirection: "row", gap: 10, paddingVertical: 9, borderBottomWidth: 1,
    borderColor: C.border, alignItems: "center" },
  remove: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  removeText: { fontSize: 18, color: C.red },
  totals: { backgroundColor: C.soft, padding: 13, borderRadius: 12, gap: 9 },
  amount: { fontWeight: "900", fontSize: 17, color: C.redDark },
  micro: { color: C.muted, fontSize: 11, lineHeight: 17 },
  input: { borderWidth: 1, borderColor: C.border, borderRadius: 9,
    paddingHorizontal: 13, paddingVertical: 10, minHeight: 44,
    color: C.dark, fontSize: 14, backgroundColor: C.paper },
  orderNote: { marginTop: 7 },
  button: { minHeight: 44, borderRadius: 10, justifyContent: "center",
    alignItems: "center", backgroundColor: C.red, paddingHorizontal: 15, paddingVertical: 11 },
  buttonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  ghost: { backgroundColor: "#FFFFFF", borderColor: C.border, borderWidth: 1 },
  ghostText: { color: C.red },
  danger: { backgroundColor: "#A52A29" },
  disabled: { opacity: 0.5 },
  products: { flexDirection: "row", flexWrap: "wrap", gap: 9, alignItems: "stretch" },
  product: { backgroundColor: C.paper, width: "48%", borderWidth: 1,
    borderColor: C.border, borderRadius: 10, overflow: "hidden" },
  productTablet: { width: "31.7%" },
  productWide: { width: "23.7%" },
  faded: { opacity: 0.55 },
  productPhoto: { width: "100%", aspectRatio: 1 },
  productEmpty: { width: "100%", aspectRatio: 1, backgroundColor: C.soft,
    alignItems: "center", justifyContent: "center" },
  productPlaceholder: { color: "#A78074", fontSize: 10, fontWeight: "800" },
  productBody: { padding: 8, gap: 3 },
  productName: { color: C.dark, fontSize: 12, fontWeight: "800", minHeight: 30 },
  productPrice: { color: C.redDark, fontWeight: "900", fontSize: 13 },
  workspaceTabs: { flexDirection: "row", alignItems: "center", gap: 5, marginRight: 8 },
  workspaceTab: { minHeight: 44, borderRadius: 9, borderWidth: 1,
    borderColor: "#A64D54", backgroundColor: "#873039", paddingHorizontal: 10,
    justifyContent: "center", alignItems: "center" },
  workspaceTabActive: { backgroundColor: "#FFF0EB", borderColor: "#FFF0EB" },
  workspaceTabText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
  workspaceTabTextActive: { color: C.redDark },
  queueLayout: { flex: 1, flexDirection: "row", padding: 10, gap: 10, minHeight: 0, minWidth: 0 },
  queueSidebar: { width: "35%", flexShrink: 0, minWidth: 0,
    borderRadius: 14, borderWidth: 1, borderColor: C.border, backgroundColor: C.paper,
    overflow: "hidden" },
  queueHeading: { minHeight: 55, paddingHorizontal: 12, paddingVertical: 10,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8,
    borderBottomWidth: 1, borderBottomColor: C.border },
  queueBadge: { backgroundColor: C.redDark, color: "#FFFFFF", fontWeight: "900",
    borderRadius: 9, paddingVertical: 5, paddingHorizontal: 9, overflow: "hidden" },
  queueRows: { padding: 10, gap: 8, flexGrow: 1 },
  queueRow: { borderWidth: 1, borderColor: C.border, backgroundColor: "#FFFFFF",
    borderRadius: 11, padding: 12, gap: 6, minHeight: 95 },
  queueRowActive: { borderColor: C.red, backgroundColor: "#FFF0EF" },
  queueTableName: { color: C.redDark, fontSize: 14, fontWeight: "900" },
  queueBadgeSmall: { color: "#A1232F", fontSize: 11, fontWeight: "800" },
  queueEmpty: { minHeight: 150, justifyContent: "center", alignItems: "center",
    gap: 7, paddingHorizontal: 12 },
  queueDetails: { flex: 1, minWidth: 0, borderRadius: 14, borderWidth: 1,
    borderColor: C.border, backgroundColor: C.paper, overflow: "hidden" },
  queueDetailScroll: { flexGrow: 1, padding: 16, gap: 13 },
  queueDetailEmpty: { flex: 1, minHeight: 150, justifyContent: "center",
    alignItems: "center", padding: 20, gap: 8 },
  reviewActions: { gap: 8, marginTop: 3 },
  ticketGroup: { gap: 8 },
  ticketGroupPending: { gap: 8, backgroundColor: "#FFF5F4",
    borderRadius: 12, padding: 8 },
  groupPendingHeading: { color: "#A3202D", fontSize: 13, fontWeight: "900" },
  groupAcceptedHeading: { color: "#216C47", fontSize: 13, fontWeight: "900" },
  detailLine: { fontSize: 11, lineHeight: 17, fontWeight: "700", color: C.redDark },
  draftPhoto: { width: 48, height: 48, borderRadius: 8, backgroundColor: C.soft },
  draftPhotoEmpty: { width: 48, height: 48, borderRadius: 8, backgroundColor: C.soft,
    alignItems: "center", justifyContent: "center" },
  mobileTileSelected: { borderWidth: 2, borderColor: C.red },
  mobileCartBar: { flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#FFF5F0", borderTopWidth: 1, borderColor: C.border,
    paddingHorizontal: 12, paddingVertical: 7 },
  loginScreen: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
  loginCard: { width: "100%", maxWidth: 420, borderRadius: 18, backgroundColor: C.paper,
    borderWidth: 1, borderColor: C.border, padding: 24, gap: 15 },
  loginTitle: { fontSize: 26, fontWeight: "900", color: C.dark },
  mobileIntro: { paddingHorizontal: 16, paddingTop: 20, gap: 5 },
  tableGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, padding: 12 },
  tableTile: { width: "47.5%", minHeight: 114, borderWidth: 1, borderRadius: 12,
    padding: 13, justifyContent: "center", gap: 6 },
  openTile: { backgroundColor: "#F9EBDA", borderColor: "#E7C4A0" },
  pendingTile: { backgroundColor: "#F9DFDF", borderColor: "#E8A0A0" },
  freeTile: { backgroundColor: C.paleGreen, borderColor: "#C2DDCA" },
  mobileAction: { gap: 10, padding: 16 },
  mobileSelected: { padding: 12, flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", backgroundColor: C.paper },
  mobileNav: { flexDirection: "row", backgroundColor: C.paper, borderTopWidth: 1,
    borderColor: C.border, padding: 5, gap: 6 },
  mobileTab: { minHeight: 50, flex: 1, alignItems: "center", justifyContent: "center",
    borderRadius: 9 },
  mobileTabOn: { backgroundColor: "#F7E5E6" },
  mobileTabText: { fontSize: 13, color: C.muted, fontWeight: "700" },
  mobileTabTextOn: { color: C.red },
});
