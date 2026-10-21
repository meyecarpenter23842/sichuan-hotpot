import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState, Image, Pressable, ScrollView, StyleSheet,
  Text, TextInput, View, useWindowDimensions,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import {
  api, branchPath, currentSession, money, productImage, setSession,
  type Area, type Bill, type Branch, type CartLine, type Menu, type Principal,
  type Product, type Receipt, type Submission, type Table, type Ticket, type Tokens,
} from "./src/pos-api";
import { clientKey } from "./src/pos-cart";
import { ProductSheet } from "./src/ProductSheet";

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
  const [categoryId, setCategoryId] = useState<string | null>(null);
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
  const branch = branches.find(b => b.id === branchId) ?? null;
  const role = branch?.staffRole ?? "";
  const activeTable = tables.find(t => t.id === selectedTableId) ?? null;
  const sessionId = activeTable?.sessions[0]?.id ?? null;
  const usableAreas = areas.filter(a => a.isActive);
  const shownTables = tables.filter(t => (!areaId || t.areaId === areaId) &&
    (t.isActive || t.sessions.length > 0));
  const currentApprovals = approvals.filter(t => t.sessionId === sessionId);
  const estimatedVnd = cart.reduce((n, x) => n + x.previewVnd, 0);

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
      setOnline(true); setError("");
    } catch (e) {
      if (version === requestVersion.current) {
        setOnline(false); setError(e instanceof Error ? e.message : "Không đồng bộ được bàn.");
      }
    } finally { if (version === requestVersion.current) setSyncing(false); }
  }, [branchId, branches]);

  useEffect(() => {
    if (!token || !branchId) return;
    void refresh(true);
    const timer = setInterval(() => { if (AppState.currentState === "active") void refresh(); }, 5000);
    const sub = AppState.addEventListener("change", s => {
      if (s === "active") void refresh(true);
    });
    return () => { clearInterval(timer); sub.remove(); };
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

  const login = async () => {
    if (lock.current || !credential.username.trim() || !credential.password) return;
    lock.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const tokens = await api<Tokens>("/auth/login", { method: "POST", anonymous: true,
        body: { username: credential.username.trim(), password: credential.password } });
      setSession(tokens);
      const [person, scoped] = await Promise.all([
        api<Principal>("/auth/me"),
        api<Branch[]>("/admin/branches"),
      ]);
      const allowed = scoped.filter(b => b.isActive && permitted.includes(b.staffRole ?? "")
        && (person.role === "OWNER" || b.staffRole !== "OWNER"));
      if (!allowed.length) {
        setSession(null);
        throw new Error("Tài khoản không có quyền bán tại quán ở chi nhánh đang hoạt động.");
      }
      setBranches(allowed);
      setBranchId(allowed[0]!.id);
      setToken(tokens.accessToken);
      setCredential(c => ({ ...c, password: "" }));
      setPage("tables");
    } catch (e) { setSession(null); setError(e instanceof Error ? e.message : "Không đăng nhập được."); }
    finally { lock.current = false; setBusy(false); }
  };
  const logout = () => {
    ++requestVersion.current;
    setSession(null); setToken(null); setBranches([]); setBranchId(null); setAreas([]);
    setTables([]); setApprovals([]); setCatalog(null); setSelectedTableId(null);
    setCart([]); setPendingSubmit(null); setBill(null); setMessage(""); setError(""); setPage("tables");
  };
  const branchChange = (value: string) => {
    if (pendingSubmit) {
      setError("Có phiếu chưa rõ kết quả. Gửi lại bằng cùng mã trước khi đổi chi nhánh.");
      return;
    }
    if (value === branchId) { setShowBranchMenu(false); return; }
    ++requestVersion.current; setBranchId(value); setAreaId(null); setSelectedTableId(null);
    setTables([]); setCatalog(null); setBill(null); setCart([]); setSearch(""); setCategoryId(null);
    setPage("tables"); setShowBranchMenu(false); setError(""); setMessage("");
  };
  const doAction = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setMessage("");
    try { await action(); }
    catch (e) { setError(e instanceof Error ? e.message : "Thao tác thất bại."); }
    finally { lock.current = false; setBusy(false); }
  };
  const selectTable = (t: Table) => {
    if (pendingSubmit && pendingSubmit.sessionId !== t.sessions[0]?.id) {
      setError("Hãy xử lý phiếu đang chờ kết quả trước khi đổi bàn."); return;
    }
    setSelectedTableId(t.id); setPage(t.sessions.length ? "menu" : "tables"); setBill(null);
  };
  const openTable = () => {
    if (!branchId || !activeTable || !canOrder(role) || !online) return;
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
    if (!branchId || !sessionId || !canOrder(role) || !cart.length || !online) return;
    const payload = pendingSubmit?.payload ?? {
      idempotencyKey: clientKey(), customerNote: note.trim(),
      items: cart.map(({ item }) => ({ ...item, modifierIds: [...item.modifierIds],
        comboOptionIds: [...item.comboOptionIds] })),
    };
    const frozen = pendingSubmit ?? { sessionId, payload };
    // Save the exact request before sending. Unknown network failures retain it for safe retry.
    setPendingSubmit(frozen);
    await doAction(async () => {
      const result = await api<Receipt>(branchPath(branchId) + "/sessions/" + frozen.sessionId + "/tickets",
        { method: "POST", body: frozen.payload });
      setPendingSubmit(null); setCart([]); setNote(""); setPage("bill");
      setMessage(result.replayed ? "Phiếu đã được ghi nhận trước đó, không tạo lại." : "Đã gửi món xuống Bếp.");
      await refresh(true);
      setBill(await api<Bill>(branchPath(branchId) + "/sessions/" + frozen.sessionId));
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
      setRejecting(null); setRejectReason("");
      setMessage(decision === "approve" ? "Đã duyệt; phiếu sẽ hiện ở Bếp đúng một lần." : "Đã từ chối yêu cầu QR.");
      await refresh(true);
      if (sessionId) setBill(await api<Bill>(branchPath(branchId) + "/sessions/" + sessionId));
    });
  };
  const products = useMemo(() => (catalog?.categories ?? []).flatMap(c =>
    c.products.map(p => ({ ...p, categoryId: c.id }))).filter(p =>
      (!categoryId || p.categoryId === categoryId) &&
      (!search.trim() || (p.name + " " + (p.description ?? "")).toLocaleLowerCase("vi")
        .includes(search.toLocaleLowerCase("vi").trim()))), [catalog, categoryId, search]);
  const removeLine = (id: string) => {
    if (pendingSubmit) return;
    setCart(c => c.filter(x => x.id !== id));
  };

  const tableStrip = <View style={st.tableSection}>
    <View style={st.sectionHead}><Text style={st.sectionTitle}>Khu vực & bàn</Text>
      <Text style={st.caption}>{tables.filter(t => t.sessions.length > 0).length} bàn đang phục vụ</Text></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false}
      contentContainerStyle={st.chips}>
      <Chip label="Tất cả khu vực" active={!areaId} onPress={() => setAreaId(null)}/>
      {usableAreas.map(a => <Chip key={a.id} label={a.name} active={areaId === a.id}
        onPress={() => setAreaId(a.id)}/>)}
    </ScrollView>
    <ScrollView horizontal showsHorizontalScrollIndicator={false}
      contentContainerStyle={st.chips}>
      {shownTables.map(t => {
        const active = !!t.sessions.length;
        const waiting = t.sessions[0]?._count.tickets ?? 0;
        return <Pressable key={t.id} accessibilityRole="button"
          accessibilityLabel={t.name + (waiting ? ", chờ duyệt " + waiting : active ? ", đang có khách" : ", trống")}
          onPress={() => selectTable(t)} style={[st.tableChip,
            selectedTableId === t.id && st.tableSelected, waiting > 0 && st.tablePending]}>
          <Text style={[st.tableCode, selectedTableId === t.id && st.selectedText]}>{t.code}</Text>
          <Text style={[st.caption, selectedTableId === t.id && st.selectedText]}>
            {waiting ? "🔔 " + waiting + " chờ" : active ? "Có khách" : "Trống"}
          </Text>
        </Pressable>;
      })}
      {!shownTables.length && <Text style={st.caption}>Chưa có bàn được bật trong khu vực.</Text>}
    </ScrollView>
  </View>;

  const approvalPanel = currentApprovals.length > 0 && canOrder(role) && <View style={st.approvals}>
    <Text style={st.sectionTitle}>🔔 {currentApprovals.length} yêu cầu QR cần duyệt</Text>
    {currentApprovals.map(t => <View key={t.id} style={st.approvalCard}>
      <Text style={st.label}>QR · {hhmm(t.createdAt)} · Đợi nhân viên xác nhận</Text>
      {t.items.map(x => <Text key={x.id} style={st.itemText}>
        {x.quantity} × {x.productName}{x.variantName ? " · " + x.variantName : ""}</Text>)}
      {!!t.customerNote && <Text style={st.caption}>Ghi chú: {t.customerNote}</Text>}
      {rejecting === t.id ? <>
        <TextInput style={st.input} value={rejectReason} maxLength={500}
          onChangeText={setRejectReason} placeholder="Lý do từ chối..." accessibilityLabel="Lý do từ chối"/>
        <View style={st.row}><Button title="Quay lại" kind="ghost"
          onPress={() => { setRejecting(null); setRejectReason(""); }} />
          <Button title="Xác nhận từ chối" danger disabled={busy || !online ||
            rejectReason.trim().length < 3} onPress={() => review(t.id, "reject")}/></View>
      </> : <View style={st.row}>
        <Button title="Duyệt đưa Bếp" disabled={busy || !online}
          onPress={() => review(t.id, "approve")}/>
        <Button title="Từ chối" kind="ghost" disabled={busy}
          onPress={() => setRejecting(t.id)}/></View>}
    </View>)}
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
      {approvalPanel}
      <Text style={st.subhead}>Các đợt đã gọi</Text>
      {!bill?.tickets.length ? <Text style={st.caption}>Chưa có món. Chọn món từ thực đơn để tạo phiếu đầu tiên.</Text> :
        bill.tickets.map(t => <View key={t.id} style={st.ticket}>
          <View style={st.rowBetween}>
            <Text style={st.ticketHead}>#{t.id.slice(0, 8)} · {t.source === "QR" ? "Khách quét QR" : "Nhân viên"}</Text>
            <Text style={st.caption}>{hhmm(t.createdAt)}</Text>
          </View>
          <Text style={st.status}>{t.status === "PENDING_APPROVAL" ? "Chờ duyệt" :
            t.status === "APPROVED" ? "Đã gửi bếp" : t.status === "REJECTED" ? "Đã từ chối" : t.status}</Text>
          {t.items.map(i => <View key={i.id} style={st.rowBetween}>
            <Text style={[st.itemText, { flex: 1 }]}>{i.quantity} × {i.productName}{i.variantName ? " (" + i.variantName + ")" : ""}</Text>
            <Text style={st.itemText}>{money(i.lineTotalVnd)}</Text>
          </View>)}
          {!!t.customerNote && <Text style={st.caption}>{t.customerNote}</Text>}
        </View>)}
      <Text style={st.subhead}>Món chuẩn bị gửi</Text>
      {!cart.length ? <Text style={st.caption}>Chưa chọn món trong giỏ.</Text> :
        cart.map(l => <View key={l.id} style={st.draftLine}>
          <View style={{ flex: 1 }}>
            <Text style={st.itemText}>{l.item.quantity} × {l.name} {l.variantName ? "· " + l.variantName : ""}</Text>
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
        <View style={st.rowBetween}><Text style={st.caption}>Đã xác nhận</Text>
          <Text style={st.itemText}>{money(bill?.subtotalVnd ?? 0)}</Text></View>
        <View style={st.rowBetween}><Text style={st.caption}>Còn thanh toán</Text>
          <Text style={st.amount}>{money(bill?.dueVnd ?? 0)}</Text></View>
        <View style={st.rowBetween}><Text style={st.caption}>Giỏ chưa gửi · tạm tính</Text>
          <Text style={st.amount}>{money(estimatedVnd)}</Text></View>
        <Text style={st.micro}>Giá cuối cùng tính trên máy chủ. Thanh toán/đóng bàn triển khai ở L07.</Text>
        {canOrder(role) && <Button title={busy ? "Đang gửi…" :
            pendingSubmit ? "Thử gửi lại phiếu cũ" : "Xác nhận & gửi Bếp"}
          disabled={busy || !online || !cart.length} onPress={() => { void send(); }} />}
        {!canOrder(role) && <Text style={st.caption}>Vai trò thu ngân chỉ xem hóa đơn, không gọi món.</Text>}
        {!!pendingSubmit && <Text style={st.warning}>Chưa xác nhận kết quả gửi. Giỏ đã khóa; hãy thử lại bằng cùng mã để tránh tạo món trùng.</Text>}
      </View>
    </>}
  </View>;

  const menuPanel = <View style={st.menuPanel}>
    <View style={st.sectionHead}><View>
      <Text style={st.sectionTitle}>Thực đơn</Text>
      <Text style={st.caption}>Ảnh và giá lấy từ cửa hàng · giá chốt tại server</Text>
    </View><Text style={st.caption}>{products.length} món</Text></View>
    <TextInput style={st.input} placeholder="Tìm lẩu, trà sữa, combo, topping…"
      placeholderTextColor="#978984" value={search} onChangeText={setSearch}
      accessibilityLabel="Tìm món"/>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.chips}>
      <Chip label="Tất cả" active={!categoryId} onPress={() => setCategoryId(null)}/>
      {(catalog?.categories ?? []).map(c => <Chip key={c.id} label={c.name}
        active={categoryId === c.id} onPress={() => setCategoryId(c.id)}/>)}
    </ScrollView>
    {!catalog ? <Text style={st.caption}>Đang tải thực đơn…</Text> :
      products.length === 0 ? <Text style={st.caption}>Không tìm thấy món phù hợp.</Text> :
        <View style={st.products}>{products.map(p => {
          const image = productImage(p.imageKey);
          return <Pressable key={p.id} accessibilityRole="button"
            accessibilityLabel={"Chọn " + p.name} disabled={!p.isAvailable || !sessionId || !canOrder(role) ||
              !!pendingSubmit || busy || !online}
            onPress={() => setSelectedProduct(p)} style={[st.product, !p.isAvailable && st.faded]}>
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
        <Button title={busy ? "Đang xác thực…" : "Đăng nhập"} disabled={busy}
          onPress={() => { void login(); }}/>
        <Text style={st.micro}>Chỉ nhân viên có quyền mới được xem bàn, gọi món và duyệt QR.</Text>
      </View>
    </View> : <>
      <View style={st.header}>
        <View style={{ flex: 1 }}>
          <Text style={st.brand}>LẨU TỨ XUYÊN</Text>
          <Pressable accessibilityRole="button" onPress={() => setShowBranchMenu(v => !v)}
            style={st.branchButton}><Text style={st.branchName} numberOfLines={1}>
              {branch?.name ?? "Chọn chi nhánh"} ▾</Text></Pressable>
        </View>
        <View style={st.headerRight}>
          <Text style={[st.caption, { color: online ? C.olive : C.red }]}>
            {online ? "● Đã kết nối" : "○ Mất mạng"}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Đồng bộ lại"
            style={st.iconButton} onPress={() => { void refresh(true); }}>
            <Text style={st.iconText}>{syncing ? "…" : "↻"}</Text></Pressable>
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
      {desktop ? <>
        {tableStrip}
        <View style={st.desktop}>
          <ScrollView style={st.leftScroll} contentContainerStyle={st.panelContent}
            keyboardShouldPersistTaps="handled">{ticketPanel}</ScrollView>
          <ScrollView style={st.rightScroll} contentContainerStyle={st.panelContent}
            keyboardShouldPersistTaps="handled">{menuPanel}</ScrollView>
        </View>
      </> : <>
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 30 }}>
          {page === "tables" ? <>
            <View style={st.mobileIntro}><Text style={st.sectionTitle}>Chọn bàn để phục vụ</Text>
              <Text style={st.caption}>Trạng thái được đồng bộ với các thiết bị khác.</Text></View>
            {tableStrip}
            <View style={st.tableGrid}>{shownTables.map(t => {
              const count = t.sessions[0]?._count.tickets ?? 0;
              return <Pressable key={t.id} accessibilityRole="button" onPress={() => selectTable(t)}
                style={[st.tableTile, count > 0 ? st.pendingTile : t.sessions.length ? st.openTile : st.freeTile]}>
                <Text style={st.tableCode}>{t.code}</Text><Text style={st.itemText}>{t.name}</Text>
                <Text style={st.caption}>{count ? "🔔 " + count + " chờ duyệt" :
                  t.sessions.length ? "Đang có khách" : "Trống"}</Text>
              </Pressable>;
            })}</View>
            {activeTable && !sessionId && canOrder(role) && <View style={st.mobileAction}>
              <Text style={st.sectionTitle}>{activeTable.name}</Text>
              <Button title="Mở phiên bàn" disabled={busy || !online} onPress={openTable}/>
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
  header: { minHeight: 76, paddingHorizontal: 18, paddingVertical: 12, backgroundColor: C.paper,
    borderBottomWidth: 1, borderColor: C.border, flexDirection: "row", alignItems: "center", gap: 10 },
  brand: { fontSize: 12, letterSpacing: 1.2, color: C.red, fontWeight: "900" },
  branchButton: { minHeight: 32, justifyContent: "center" },
  branchName: { fontSize: 18, fontWeight: "800", color: C.dark },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  iconButton: { minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center",
    backgroundColor: C.soft, borderRadius: 10 },
  iconText: { fontSize: 21, color: C.red },
  exit: { minHeight: 44, paddingHorizontal: 10, justifyContent: "center" },
  exitText: { color: C.red, fontWeight: "800", fontSize: 12 },
  branchPicker: { position: "absolute", zIndex: 90, top: 76, left: 12, minWidth: 230,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.paper,
    borderRadius: 12, padding: 6, elevation: 8 },
  branchItem: { minHeight: 44, paddingHorizontal: 13, justifyContent: "center" },
  alert: { flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "#FFEAEA" },
  warning: { color: C.redDark, fontSize: 13, flexShrink: 1, lineHeight: 19 },
  success: { flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 14, paddingVertical: 8, backgroundColor: C.paleGreen },
  successText: { color: C.olive, fontSize: 13, fontWeight: "700", flex: 1 },
  desktop: { flex: 1, flexDirection: "row", padding: 12, gap: 12, minHeight: 0 },
  leftScroll: { width: "40%", backgroundColor: C.paper, borderRadius: 14,
    borderWidth: 1, borderColor: C.border },
  rightScroll: { flex: 1, backgroundColor: C.paper, borderRadius: 14,
    borderWidth: 1, borderColor: C.border },
  panelContent: { padding: 16, paddingBottom: 32 },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  sectionTitle: { fontSize: 16, color: C.dark, fontWeight: "800" },
  caption: { fontSize: 12, lineHeight: 18, color: C.muted },
  tableSection: { paddingHorizontal: 15, paddingTop: 12, paddingBottom: 10, gap: 9,
    backgroundColor: C.paper, borderBottomWidth: 1, borderColor: C.border },
  chips: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 1 },
  chip: { minHeight: 44, justifyContent: "center", borderRadius: 10, borderWidth: 1,
    borderColor: C.border, paddingHorizontal: 14, backgroundColor: C.paper },
  chipOn: { borderColor: C.red, backgroundColor: "#FCE8E8" },
  chipText: { fontSize: 12, fontWeight: "700", color: C.dark },
  chipTextOn: { color: C.red },
  tableChip: { minWidth: 93, minHeight: 62, paddingHorizontal: 11, paddingVertical: 7,
    backgroundColor: C.paleGreen, borderColor: "#C5E2D2", borderWidth: 1, borderRadius: 10, gap: 3 },
  tableSelected: { backgroundColor: C.red, borderColor: C.red },
  tablePending: { borderColor: "#EBAD74" },
  tableCode: { fontWeight: "900", fontSize: 17, color: C.dark },
  selectedText: { color: "#FFFFFF" },
  billPanel: { gap: 15 },
  menuPanel: { gap: 15 },
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
  products: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  product: { backgroundColor: C.paper, width: "47.5%", borderWidth: 1,
    borderColor: C.border, borderRadius: 12, overflow: "hidden", minHeight: 194 },
  faded: { opacity: 0.55 },
  productPhoto: { width: "100%", height: 122 },
  productEmpty: { width: "100%", height: 122, backgroundColor: C.soft,
    alignItems: "center", justifyContent: "center" },
  productPlaceholder: { color: "#A78074", fontSize: 11, fontWeight: "800" },
  productBody: { padding: 10, gap: 6 },
  productName: { color: C.dark, fontSize: 13, fontWeight: "800", minHeight: 36 },
  productPrice: { color: C.red, fontWeight: "800", fontSize: 14 },
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
