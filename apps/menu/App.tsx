import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState, Image, Pressable, ScrollView, StyleSheet,
  Text, TextInput, View, useWindowDimensions,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import {
  getApi, MenuApiError, money, productImage, readQrHandle,
  type CartLine, type GuestBill, type GuestGrant, type GuestTicket,
  type Locator, type Menu, type Product, type Receipt, type Submission,
} from "./src/menu-api";
import { clientKey } from "./src/menu-cart";
import { ProductSheet } from "./src/ProductSheet";

const tone = {
  red: "#9B3039", wine: "#69212A", ink: "#322523", muted: "#776B66",
  cream: "#FAF6F1", soft: "#F5EBE3", border: "#E8DDD5", white: "#FFFFFF",
  green: "#246C51", paleGreen: "#E8F4EC", warning: "#9C5A15", paleGold: "#FFF0D7",
};
type Phase = "loading" | "ready" | "waiting" | "invalid" | "expired" | "error";
type Screen = "menu" | "cart" | "status";
type SavedGrant = { handle: string; credential: string; expiresAt: string; sessionId: string; instanceId: string };
type FrozenDraft = { sessionId: string; instanceId: string; payload: Submission; cart: CartLine[]; note: string };
function cacheKey(handle: string) { return "sichuan-menu-guest-v1-" + handle; }
function submissionKey(handle: string) { return "sichuan-menu-request-v1-" + handle; }
function cartKey(handle: string) { return "sichuan-menu-cart-v1-" + handle; }
function getStored<T>(key: string): T | null {
  try { const raw = typeof window === "undefined" ? null : window.sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : null; } catch { return null; }
}
function saveStored(key: string, data: unknown) {
  try { if (typeof window !== "undefined") window.sessionStorage.setItem(key, JSON.stringify(data)); }
  catch { /* Safari private mode can reject storage; in-memory session still works. */ }
}
function removeStored(key: string) {
  try { if (typeof window !== "undefined") window.sessionStorage.removeItem(key); } catch { /* no-op */ }
}
function localTime(value: string) {
  return new Date(value).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}
function stateLabel(state: string) {
  switch (state) {
    case "PENDING_APPROVAL": return "Đang chờ nhân viên xác nhận";
    case "APPROVED": return "Nhân viên đã xác nhận · Đã gửi Bếp";
    case "PREPARING": return "Bếp đang chuẩn bị";
    case "READY": return "Món đã sẵn sàng";
    case "SERVED": return "Đã phục vụ";
    case "REJECTED": return "Nhân viên đã từ chối";
    default: return "Đang cập nhật";
  }
}
function NavButton({ label, selected, onPress, count }: {
  label: string; selected: boolean; onPress: () => void; count?: number;
}) {
  return <Pressable accessibilityRole="tab" accessibilityState={{ selected }}
    onPress={onPress} style={[s.navButton, selected && s.navActive]}>
    <Text style={[s.navText, selected && s.navTextActive]}>{label}{count ? " (" + count + ")" : ""}</Text>
  </Pressable>;
}
function Button({ label, onPress, disabled, secondary }: {
  label: string; onPress: () => void; disabled?: boolean; secondary?: boolean;
}) {
  return <Pressable accessibilityRole="button" disabled={disabled}
    accessibilityState={{ disabled: !!disabled }}
    style={[s.button, secondary && s.secondaryButton, disabled && s.disabled]} onPress={onPress}>
    <Text style={[s.buttonLabel, secondary && s.secondaryLabel]}>{label}</Text>
  </Pressable>;
}
export default function App() {
  const { width } = useWindowDimensions();
  const wide = width >= 768;
  // QR URL contains a public unguessable table locator, never a bearer token.
  const [handle] = useState<string | null>(() =>
    readQrHandle(typeof window === "undefined" ? "" : window.location.search));
  const [phase, setPhase] = useState<Phase>("loading");
  const [locator, setLocator] = useState<Locator | null>(null);
  const [catalog, setCatalog] = useState<Menu | null>(null);
  const [grant, setGrant] = useState<SavedGrant | null>(null);
  const guestRef = useRef<SavedGrant | null>(null);
  const [tickets, setTickets] = useState<GuestTicket[]>([]);
  const [bill, setBill] = useState<GuestBill | null>(null);
  const [screen, setScreen] = useState<Screen>("menu");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [note, setNote] = useState("");
  const [frozen, setFrozen] = useState<FrozenDraft | null>(null);
  const [sending, setSending] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [online, setOnline] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const alive = useRef(true);
  const sendingLock = useRef(false);
  const requestId = useRef(0);
  const totalDraft = cart.reduce((value, line) => value + line.previewVnd, 0);
  const products = useMemo(() => (catalog?.categories ?? [])
    .flatMap(group => group.products.map(product => ({ ...product, categoryId: group.id })))
    .filter(p => (!category || p.categoryId === category) &&
      (!search.trim() || (p.name + " " + (p.description ?? "")).toLocaleLowerCase("vi")
        .includes(search.trim().toLocaleLowerCase("vi")))), [catalog, category, search]);
  const updateGrant = useCallback((value: SavedGrant | null) => {
    guestRef.current = value;
    setGrant(value);
    if (handle) {
      if (value) saveStored(cacheKey(handle), value);
      else removeStored(cacheKey(handle));
    }
  }, [handle]);
  const revoke = useCallback((why: string) => {
    guestRef.current = null; setGrant(null); setPhase("expired");
    setTickets([]); setBill(null); setError(why);
    if (handle) removeStored(cacheKey(handle));
  }, [handle]);

  const sync = useCallback(async (current: SavedGrant, visible = false) => {
    if (visible) setSyncing(true);
    try {
      // Renew BEFORE expiration: same grant ID retains only this guest's tickets.
      if (Date.parse(current.expiresAt) - Date.now() < 5 * 60_000) {
        const renew = await getApi<{ expiresAt: string }>("/dining/guest/renew",
          current.credential, "POST");
        const next = { ...current, expiresAt: renew.expiresAt };
        if (guestRef.current?.credential === current.credential) {
          guestRef.current = next; setGrant(next);
          if (handle) saveStored(cacheKey(handle), next);
        }
      }
      const [mine, shared] = await Promise.all([
        getApi<GuestTicket[]>("/dining/guest/tickets", current.credential),
        getApi<GuestBill>("/dining/guest/bill", current.credential),
      ]);
      if (guestRef.current?.credential !== current.credential) return;
      setTickets(mine); setBill(shared); setOnline(true);
      setError(previous => previous.includes("Mất kết nối") ? "" : previous);
    } catch (err) {
      if (guestRef.current?.credential !== current.credential) return;
      if (err instanceof MenuApiError && err.status === 401) {
        revoke("Phiên bàn đã đóng, mã QR bị thu hồi hoặc quyền xem đã hết hạn. Vui lòng báo nhân viên.");
      } else {
        setOnline(false);
        setError("Mất kết nối. Giỏ và yêu cầu đã gửi được giữ nguyên; vui lòng kiểm tra lại.");
      }
    } finally { if (visible) setSyncing(false); }
  }, [handle, revoke]);

  const connect = useCallback(async () => {
    if (!handle) { setPhase("invalid"); setError("Vui lòng quét mã QR được dán trên bàn."); return; }
    const seq = ++requestId.current;
    setPhase("loading"); setError(""); setMessage("");
    try {
      const info = await getApi<Locator>("/dining/qr/" + handle);
      const menu = await getApi<Menu>("/catalog/branches/" + info.branchId);
      if (seq !== requestId.current) return;
      setLocator(info); setCatalog(menu);
      let saved = getStored<SavedGrant>(cacheKey(handle));
      if (saved && (saved.handle !== handle || !saved.instanceId || Date.parse(saved.expiresAt) <= Date.now())) {
        saved = null; removeStored(cacheKey(handle));
      }
      let current = saved;
      if (current) {
        try { await getApi<GuestTicket[]>("/dining/guest/tickets", current.credential); }
        catch (err) {
          if (err instanceof MenuApiError && err.status === 401) {
            current = null; removeStored(cacheKey(handle));
          } else throw err;
        }
      }
      if (!current) {
        const fresh = await getApi<GuestGrant>("/dining/qr/" + handle + "/grants", undefined, "POST");
        current = { handle, ...fresh, instanceId: clientKey() };
      }
      if (seq !== requestId.current) return;
      updateGrant(current); setPhase("ready"); setOnline(true);
      const draft = getStored<FrozenDraft>(submissionKey(handle));
      if (draft?.sessionId === current.sessionId && draft.instanceId === current.instanceId) {
        setFrozen(draft); setCart(draft.cart); setNote(draft.note);
        setMessage("Có phiếu chưa xác nhận kết quả. Hãy kiểm tra lịch sử hoặc gửi lại đúng phiếu cũ.");
        setScreen("cart");
      } else if (draft) {
        setFrozen(null); removeStored(submissionKey(handle));
        setError("Có yêu cầu từ phiên bàn cũ. Vui lòng nhờ nhân viên kiểm tra trước khi gọi tiếp.");
      }
      if (!draft) {
        const unsent = getStored<{ sessionId: string; cart: CartLine[]; note: string }>(cartKey(handle));
        if (unsent?.sessionId === current.sessionId && Array.isArray(unsent.cart)) {
          setCart(unsent.cart); setNote(unsent.note ?? "");
        } else if (unsent) {
          removeStored(cartKey(handle));
        }
      }
      void sync(current, true);
    } catch (err) {
      if (seq !== requestId.current) return;
      setOnline(!(err instanceof MenuApiError && err.status === 0));
      if (err instanceof MenuApiError && err.status === 409) {
        setPhase("waiting");
        setError("Bàn chưa mở phiên. Vui lòng nhờ nhân viên mở bàn, sau đó chọn Kiểm tra lại.");
      } else if (err instanceof MenuApiError && (err.status === 404 || err.status === 400)) {
        setPhase("invalid"); setError(err.message);
      } else {
        setPhase("error"); setError(err instanceof Error ? err.message : "Không tải được thực đơn.");
      }
    }
  }, [handle, sync, updateGrant]);

  useEffect(() => {
    alive.current = true;
    void connect();
    return () => { alive.current = false; };
  }, [connect]);
  useEffect(() => {
    if (phase !== "ready") return;
    const timer = setInterval(() => {
      if (AppState.currentState === "active" && guestRef.current) void sync(guestRef.current);
    }, 10000);
    const sub = AppState.addEventListener("change", state => {
      if (state === "active" && guestRef.current) void sync(guestRef.current, true);
    });
    return () => { clearInterval(timer); sub.remove(); };
  }, [phase, sync]);

  // Per-tab unsent cart survives Safari/Chrome reload, but never crosses a dining session.
  useEffect(() => {
    if (!grant || !handle || frozen) return;
    if (cart.length || note.trim()) {
      saveStored(cartKey(handle), { sessionId: grant.sessionId, cart, note });
    } else {
      removeStored(cartKey(handle));
    }
  }, [cart, note, grant, frozen, handle]);

  const send = async () => {
    const current = guestRef.current;
    if (sendingLock.current || !current || !cart.length || !online) return;
    sendingLock.current = true; setSending(true); setError(""); setMessage("");
    const queued: FrozenDraft = frozen ?? {
      sessionId: current.sessionId, instanceId: current.instanceId,
      cart: cart.map(item => ({ ...item, item: { ...item.item } })), note,
      payload: {
        idempotencyKey: clientKey(),
        customerNote: note.trim(),
        items: cart.map(line => ({ ...line.item, modifierIds: [...line.item.modifierIds],
          comboOptionIds: [...line.item.comboOptionIds] })),
      },
    };
    // Persist exact payload and its idempotency key *before* network request.
    if (!frozen) { setFrozen(queued); if (handle) saveStored(submissionKey(handle), queued); }
    try {
      const result = await getApi<Receipt>("/dining/guest/tickets", current.credential, "POST", queued.payload);
      if (alive.current) {
        setFrozen(null); if (handle) removeStored(submissionKey(handle));
        setCart([]); setNote(""); setScreen("status");
        setMessage("Đã gửi yêu cầu #" + result.ticketId.slice(0, 8) +
          ". Đang chờ nhân viên xác nhận, món chưa chuyển xuống Bếp.");
        await sync(current, true);
      }
    } catch (err) {
      if (!alive.current) return;
      setError(err instanceof Error ? err.message : "Chưa xác nhận đã gửi món.");
      if (err instanceof MenuApiError && err.status === 401) {
        revoke("Phiên bàn đã hết hạn. Nếu vừa gửi món, hãy nhờ nhân viên kiểm tra trước khi quét lại.");
      } else {
        setMessage("Chưa rõ yêu cầu đã được nhận hay chưa. Bấm Thử gửi lại để dùng đúng mã phiếu cũ.");
      }
    } finally { sendingLock.current = false; if (alive.current) setSending(false); }
  };
  const add = (line: CartLine) => {
    if (frozen) return;
    setCart(prev => [...prev, line]); setSelectedProduct(null);
    setMessage("Đã thêm món vào giỏ. Chưa gửi yêu cầu cho quán.");
  };
  const canOrder = phase === "ready" && !!grant && online && !sending;
  return <SafeAreaProvider><SafeAreaView style={s.safe} edges={["top", "bottom"]}>
    <View style={s.header}>
      <View style={s.brand}><Text style={s.brandSmall}>LẨU TỨ XUYÊN</Text>
        <Text style={s.brandTitle}>Gọi món tại bàn</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel="Kiểm tra kết nối và đơn"
        onPress={() => { if (guestRef.current) void sync(guestRef.current, true); else void connect(); }}
        style={s.headerRefresh}><Text style={s.headerRefreshText}>{syncing ? "…" : "↻"}</Text></Pressable>
    </View>
    {locator && <View style={s.tableBanner}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.tableName}>{locator.table} · {locator.area}</Text>
        <Text style={s.shopName}>{locator.branch}</Text>
      </View>
      <View style={[s.connection, online && phase === "ready" ? s.connected : s.disconnected]}>
        <Text style={s.connectionText}>{phase === "ready" && online ? "● Đã kết nối" :
          phase === "waiting" ? "○ Chờ mở bàn" : "○ Chưa kết nối"}</Text></View>
    </View>}
    {!!error && <View style={s.errorBar}><Text accessibilityRole="alert" style={s.errorText}>{error}</Text>
      <Pressable accessibilityRole="button" onPress={() => setError("")} style={s.dismiss}>
        <Text style={s.errorText}>×</Text></Pressable></View>}
    {!!message && <View style={s.noticeBar}><Text style={s.noticeText}>{message}</Text>
      <Pressable accessibilityRole="button" onPress={() => setMessage("")} style={s.dismiss}>
        <Text style={s.noticeText}>×</Text></Pressable></View>}
    {phase === "loading" ? <View style={s.center}>
      <Text style={s.bigSymbol}>🍲</Text><Text style={s.centerTitle}>Đang tải thực đơn bàn…</Text>
      <Text style={s.muted}>Vui lòng đợi một chút.</Text></View> :
      phase === "invalid" || phase === "error" || phase === "expired" ?
        <View style={s.center}>
          <Text style={s.bigSymbol}>🍲</Text>
          <Text style={s.centerTitle}>{phase === "invalid" ? "Mã QR không hợp lệ" :
            phase === "expired" ? "Phiên bàn đã kết thúc" : "Không kết nối được"}</Text>
          <Text style={s.muted}>Vui lòng kiểm tra mã tại bàn hoặc nhờ nhân viên hỗ trợ.</Text>
          <Button label="Kiểm tra lại" onPress={() => { void connect(); }}/>
        </View> : <>
        {phase === "waiting" && <View style={s.waiting}>
          <Text style={s.waitTitle}>Bàn chưa mở phiên phục vụ</Text>
          <Text style={s.muted}>Anh/chị có thể xem trước thực đơn. Khi nhân viên mở bàn, bấm Kiểm tra lại để gọi món.</Text>
          <Button label="Kiểm tra lại" onPress={() => { void connect(); }}/>
        </View>}
        <View style={s.nav}>
          <NavButton label="Thực đơn" selected={screen === "menu"} onPress={() => setScreen("menu")}/>
          <NavButton label="Giỏ món" selected={screen === "cart"} count={cart.length}
            onPress={() => setScreen("cart")}/>
          <NavButton label="Yêu cầu" selected={screen === "status"} count={tickets.filter(t => t.status === "PENDING_APPROVAL").length}
            onPress={() => setScreen("status")}/>
        </View>
        <ScrollView style={s.scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={s.scrollContent}>
          <View style={[s.page, wide && s.widePage]}>
            {screen === "menu" && <>
              <View style={s.intro}><Text style={s.heading}>Hôm nay ăn gì?</Text>
                <Text style={s.muted}>Chọn món yêu thích, nhân viên sẽ xác nhận trước khi chuyển Bếp.</Text></View>
              <TextInput style={s.search} placeholder="Tìm món, topping, trà sữa…" maxLength={100}
                placeholderTextColor="#8B817D" value={search} onChangeText={setSearch} accessibilityLabel="Tìm món"/>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.categoryBar}>
                <Chip label="Tất cả" checked={!category} onPress={() => setCategory(null)}/>
                {(catalog?.categories ?? []).map(g => <Chip key={g.id} label={g.name}
                  checked={category === g.id} onPress={() => setCategory(g.id)}/>)}
              </ScrollView>
              {!products.length ? <Text style={s.empty}>Không có món phù hợp.</Text> :
                <View style={s.grid}>{products.map(product => {
                  const image = productImage(product.imageKey);
                  return <Pressable key={product.id} accessibilityRole="button"
                    accessibilityLabel={"Chọn " + product.name}
                    disabled={!canOrder || !product.isAvailable || !!frozen}
                    onPress={() => setSelectedProduct(product)}
                    style={[s.product, wide && s.productWide, (!canOrder || !product.isAvailable) && s.disabled]}>
                    {image ? <Image source={{ uri: image }} resizeMode="cover" style={s.productImage}/> :
                      <View style={s.productFallback}><Text style={s.fallbackText}>LẨU TỨ XUYÊN</Text></View>}
                    <View style={s.productBody}>
                      <Text numberOfLines={2} style={s.productName}>{product.name}</Text>
                      <Text style={s.price}>{money(product.priceVnd)}</Text>
                      <Text style={s.micro}>{!product.isAvailable ? "Tạm hết hàng" :
                        !canOrder ? "Chờ mở bàn" : product.kind === "COMBO" ? "Tùy chỉnh combo +" : "Chọn món +"}</Text>
                    </View>
                  </Pressable>;
                })}</View>}
            </>}
            {screen === "cart" && <>
              <Text style={s.heading}>Giỏ gọi món</Text>
              <Text style={s.muted}>Chỉ gửi yêu cầu sau khi bấm xác nhận. Nhân viên cần duyệt trước khi Bếp nhận.</Text>
              {!cart.length ? <View style={s.emptyCard}><Text style={s.empty}>Chưa có món trong giỏ.</Text>
                <Button secondary label="Xem thực đơn" onPress={() => setScreen("menu")}/></View> :
                cart.map(line => <View key={line.id} style={s.cartLine}>
                  <View style={{ flex: 1, gap: 5 }}>
                    <Text style={s.productName}>{line.item.quantity} × {line.name}</Text>
                    {!!line.variantName && <Text style={s.muted}>{line.variantName}</Text>}
                    {!!line.item.note && <Text style={s.micro}>Ghi chú: {line.item.note}</Text>}
                    <Text style={s.price}>{money(line.previewVnd)}</Text>
                  </View>
                  <Pressable accessibilityRole="button" accessibilityLabel={"Bỏ " + line.name}
                    style={s.remove} disabled={!!frozen || sending}
                    onPress={() => setCart(prev => prev.filter(item => item.id !== line.id))}>
                    <Text style={s.removeText}>×</Text>
                  </Pressable>
                </View>)}
              {!!cart.length && <>
                <Text style={s.fieldTitle}>Ghi chú chung cho quán</Text>
                <TextInput accessibilityLabel="Ghi chú yêu cầu" multiline maxLength={500}
                  style={s.note} editable={!frozen} value={note} onChangeText={setNote}
                  placeholder="Ví dụ: Lên món lần lượt, xin thêm chén…" placeholderTextColor="#8B817D"/>
                <View style={s.totalBox}>
                  <View style={s.totalRow}><Text style={s.muted}>Tổng giỏ dự kiến</Text>
                    <Text style={s.total}>{money(totalDraft)}</Text></View>
                  <Text style={s.micro}>Giá cuối cùng do máy chủ xác nhận. Món chưa duyệt không tính vào hóa đơn.</Text>
                  {!!frozen && <Text style={s.alertText}>Yêu cầu trước chưa rõ kết quả. Giỏ đang được khóa để tránh gửi trùng; bấm gửi lại dùng cùng mã phiếu.</Text>}
                  <Button label={sending ? "Đang gửi…" :
                    frozen ? "Thử gửi lại phiếu cũ" : "Gửi yêu cầu gọi món"}
                    disabled={!canOrder || !cart.length}
                    onPress={() => { void send(); }}/>
                </View>
              </>}
            </>}
            {screen === "status" && <>
              <Text style={s.heading}>Các yêu cầu đã gửi</Text>
              <Text style={s.muted}>Chỉ hiển thị yêu cầu của thiết bị này trong phiên bàn hiện tại. Cập nhật tự động khi mở trang.</Text>
              {!tickets.length ? <View style={s.emptyCard}><Text style={s.empty}>Chưa gửi yêu cầu nào.</Text>
                <Button secondary label="Gọi món" onPress={() => setScreen("menu")}/></View> :
                tickets.map(ticket => <View key={ticket.id} style={s.ticketCard}>
                  <View style={s.ticketTop}><Text style={s.ticketCode}>Phiếu #{ticket.id.slice(0, 8)}</Text>
                    <Text style={s.micro}>{localTime(ticket.createdAt)}</Text></View>
                  <Text style={[s.ticketStatus, ticket.status === "REJECTED" && s.rejected]}>
                    {stateLabel(ticket.status)}</Text>
                  {ticket.items.map(item => <View key={item.id} style={s.ticketItem}>
                    <Text style={s.muted}>{item.quantity} × {item.productName}
                      {item.variantName ? " · " + item.variantName : ""}</Text>
                    <Text style={s.muted}>{money(item.lineTotalVnd)}</Text>
                  </View>)}
                  {!!ticket.rejectionReason && <Text style={s.alertText}>Lý do: {ticket.rejectionReason}</Text>}
                  {!!ticket.customerNote && <Text style={s.micro}>Ghi chú: {ticket.customerNote}</Text>}
                </View>)}
              <View style={s.totalBox}><View style={s.totalRow}>
                <Text style={s.muted}>Món đã được duyệt của bàn</Text>
                <Text style={s.total}>{money(bill?.subtotalVnd ?? 0)}</Text></View>
                <Text style={s.micro}>Không bao gồm yêu cầu chờ duyệt hoặc bị từ chối. Thanh toán do nhân viên thực hiện tại quán.</Text>
              </View>
              <Button secondary label="Gọi thêm món" onPress={() => setScreen("menu")}/>
              <Button secondary label={syncing ? "Đang đồng bộ…" : "Cập nhật trạng thái"}
                disabled={syncing || !grant} onPress={() => {
                  if (guestRef.current) void sync(guestRef.current, true);
                }}/>
            </>}
          </View>
        </ScrollView>
        {screen === "menu" && cart.length > 0 && <View style={s.stickyFooter}>
          <Text style={s.footerText}>{cart.length} món · {money(totalDraft)} dự kiến</Text>
          <Button label="Xem giỏ →" onPress={() => setScreen("cart")}/>
        </View>}
      </>}
    {selectedProduct && <ProductSheet key={selectedProduct.id} product={selectedProduct}
      onClose={() => setSelectedProduct(null)} onAdd={add}/>}
  </SafeAreaView></SafeAreaProvider>;
}
function Chip({ label, checked, onPress }: { label: string; checked: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected: checked }}
    style={[s.chip, checked && s.chipActive]} onPress={onPress}>
    <Text style={[s.chipText, checked && s.chipTextActive]}>{label}</Text>
  </Pressable>;
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: tone.cream },
  header: { minHeight: 66, paddingHorizontal: 16, paddingVertical: 11, backgroundColor: tone.white,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderBottomWidth: 1, borderBottomColor: tone.border, gap: 10 },
  brand: { flex: 1, gap: 3 },
  brandSmall: { color: tone.red, fontWeight: "900", letterSpacing: 1.2, fontSize: 11 },
  brandTitle: { fontSize: 19, fontWeight: "900", color: tone.ink },
  headerRefresh: { height: 44, width: 44, backgroundColor: tone.soft, borderRadius: 10,
    alignItems: "center", justifyContent: "center" },
  headerRefreshText: { fontSize: 24, fontWeight: "800", color: tone.red },
  tableBanner: { minHeight: 63, flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 9, backgroundColor: tone.wine, gap: 8 },
  tableName: { color: tone.white, fontSize: 15, fontWeight: "800" },
  shopName: { color: "#EBC6BA", fontSize: 11 },
  connection: { padding: 7, borderRadius: 8, minWidth: 92, alignItems: "center" },
  connected: { backgroundColor: "#2F5744" },
  disconnected: { backgroundColor: "#91632E" },
  connectionText: { fontSize: 10, color: tone.white, fontWeight: "800" },
  errorBar: { flexDirection: "row", alignItems: "center", padding: 11, gap: 12, backgroundColor: "#FFE5E3" },
  errorText: { fontSize: 12, color: tone.wine, flex: 1, lineHeight: 19 },
  dismiss: { minWidth: 44, minHeight: 44, justifyContent: "center", alignItems: "center" },
  noticeBar: { flexDirection: "row", alignItems: "center", padding: 11, gap: 12, backgroundColor: tone.paleGreen },
  noticeText: { fontSize: 12, lineHeight: 19, color: tone.green, flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 28, gap: 14 },
  bigSymbol: { fontSize: 56 },
  centerTitle: { color: tone.ink, fontSize: 20, fontWeight: "900", textAlign: "center" },
  muted: { color: tone.muted, fontSize: 13, lineHeight: 20 },
  waiting: { padding: 16, backgroundColor: tone.paleGold, gap: 12 },
  waitTitle: { color: tone.wine, fontWeight: "900", fontSize: 15 },
  nav: { minHeight: 54, backgroundColor: tone.white, borderBottomWidth: 1,
    borderBottomColor: tone.border, flexDirection: "row", paddingHorizontal: 8, gap: 5 },
  navButton: { flex: 1, minHeight: 48, borderBottomWidth: 3, borderBottomColor: "transparent",
    alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  navActive: { borderBottomColor: tone.red },
  navText: { color: tone.muted, fontSize: 13, fontWeight: "700" },
  navTextActive: { color: tone.red },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingBottom: 30 },
  page: { width: "100%", maxWidth: 1000, alignSelf: "center", padding: 12, gap: 14 },
  widePage: { paddingHorizontal: 24 },
  intro: { gap: 6, marginTop: 5 },
  heading: { fontSize: 21, fontWeight: "900", color: tone.ink },
  search: { backgroundColor: tone.white, borderRadius: 11, borderWidth: 1,
    borderColor: tone.border, fontSize: 14, color: tone.ink, minHeight: 46, paddingHorizontal: 14 },
  categoryBar: { gap: 8, alignItems: "center", paddingVertical: 2 },
  chip: { minHeight: 44, backgroundColor: tone.white, borderWidth: 1, borderColor: tone.border,
    paddingHorizontal: 13, borderRadius: 10, justifyContent: "center" },
  chipActive: { backgroundColor: tone.wine, borderColor: tone.wine },
  chipText: { color: tone.ink, fontSize: 12, fontWeight: "700" },
  chipTextActive: { color: tone.white },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  product: { width: "47%", backgroundColor: tone.white, borderRadius: 13,
    borderWidth: 1, borderColor: tone.border, overflow: "hidden", minHeight: 206 },
  productWide: { width: "31%" },
  productImage: { width: "100%", height: 126 },
  productFallback: { height: 126, backgroundColor: tone.soft,
    justifyContent: "center", alignItems: "center" },
  fallbackText: { color: "#BA8777", fontSize: 11, fontWeight: "900" },
  productBody: { padding: 10, gap: 6 },
  productName: { color: tone.ink, fontSize: 14, fontWeight: "800" },
  price: { color: tone.red, fontSize: 15, fontWeight: "900" },
  micro: { color: tone.muted, fontSize: 11, lineHeight: 17 },
  disabled: { opacity: 0.5 },
  empty: { color: tone.muted, fontSize: 14, lineHeight: 22 },
  emptyCard: { padding: 23, backgroundColor: tone.white, borderRadius: 12,
    gap: 14, alignItems: "flex-start" },
  cartLine: { backgroundColor: tone.white, padding: 14, borderWidth: 1,
    borderColor: tone.border, borderRadius: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  remove: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  removeText: { fontSize: 22, color: tone.red },
  fieldTitle: { color: tone.ink, fontWeight: "800", fontSize: 14 },
  note: { borderWidth: 1, borderColor: tone.border, minHeight: 78,
    backgroundColor: tone.white, padding: 12, borderRadius: 11,
    color: tone.ink, fontSize: 14, textAlignVertical: "top" },
  totalBox: { backgroundColor: tone.soft, padding: 15, borderRadius: 13, gap: 12 },
  totalRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  total: { color: tone.red, fontWeight: "900", fontSize: 17 },
  button: { backgroundColor: tone.red, borderRadius: 11, minHeight: 48, paddingHorizontal: 17,
    paddingVertical: 11, alignItems: "center", justifyContent: "center" },
  buttonLabel: { fontSize: 14, fontWeight: "800", color: tone.white },
  secondaryButton: { backgroundColor: tone.white, borderWidth: 1, borderColor: tone.red },
  secondaryLabel: { color: tone.red },
  alertText: { color: tone.warning, fontSize: 12, lineHeight: 18 },
  ticketCard: { backgroundColor: tone.white, padding: 15, borderRadius: 12,
    borderWidth: 1, borderColor: tone.border, gap: 10 },
  ticketTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  ticketCode: { color: tone.ink, fontSize: 13, fontWeight: "900" },
  ticketStatus: { color: tone.green, fontSize: 14, fontWeight: "800", lineHeight: 20 },
  rejected: { color: tone.red },
  ticketItem: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  stickyFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: tone.white, borderTopWidth: 1, borderColor: tone.border, padding: 10, gap: 8 },
  footerText: { flex: 1, color: tone.ink, fontSize: 12, fontWeight: "800" },
});
