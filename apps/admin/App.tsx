import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, AppState, Image, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StatusBar, StyleSheet, Text, View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import {
  AdminApiError, forgetSession, refreshSession, rememberSession, request,
  type AdminCatalog, type AuthTokens, type Branch, type Principal,
} from "./src/api";
import { CatalogPanel } from "./src/CatalogPanel";
import { BranchPanel } from "./src/BranchPanel";
import { SettingsHub } from "./src/SettingsHub";
import { OrderQueuePanel, type StaffOrder } from "./src/OrderQueuePanel";
import { watchOrderEvents } from "./src/order-realtime";
import { OrderAlertWatcher } from "./src/OrderAlertWatcher";
import { loadOrderChime, saveOrderChime } from "./src/order-notifications";
import { Icon, type IconName } from "./src/Icon";
import { Action, Field, Notice } from "./src/ui";
import { c, font } from "./src/theme";

type Tab = "overview" | "orders" | "kitchen" | "catalog" | "delivery" | "settings" | "account";
const tabs: { id: Tab; label: string; shortLabel: string; icon: IconName }[] = [
  { id: "overview", label: "Tổng quan", shortLabel: "Tổng quan", icon: "dashboard" },
  { id: "orders", label: "Đơn hàng", shortLabel: "Đơn", icon: "orders" },
  { id: "kitchen", label: "Bếp", shortLabel: "Bếp", icon: "kitchen" },
  { id: "catalog", label: "Thực đơn", shortLabel: "Món", icon: "catalog" },
  { id: "delivery", label: "Giao hàng", shortLabel: "Giao", icon: "delivery" },
  { id: "settings", label: "Thiết lập", shortLabel: "Thiết lập", icon: "settings" },
  { id: "account", label: "Tài khoản", shortLabel: "Tài khoản", icon: "account" },
];
function roleName(role: string): string {
  return role === "OWNER" ? "Chủ cửa hàng" : role === "KITCHEN" ? "Nhân viên bếp" :
    role === "DRIVER" ? "Nhân viên giao hàng" : "Quản lý chi nhánh";
}
const formatMoney = (value: number): string => value.toLocaleString("vi-VN") + "đ";

function Overview({ catalog, token, branchId, onChangeTab }: {
  catalog: AdminCatalog; token: string; branchId: string;
  onChangeTab: (tab: Tab) => void;
}) {
  const [orders, setOrders] = useState<StaffOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncError, setSyncError] = useState("");
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const sequence = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++sequence.current;
    try {
      const rows = await request<StaffOrder[]>("/admin/orders/" + branchId, token);
      if (id !== sequence.current) return;
      setOrders(rows);
      setSyncError("");
      setLastSync(new Date());
    } catch (error) {
      if (id === sequence.current) setSyncError(error instanceof Error ? error.message : "Không đồng bộ được đơn.");
    } finally {
      if (id === sequence.current) setLoading(false);
    }
  }, [branchId, token]);

  useEffect(() => {
    setOrders([]); setLoading(true); setLastSync(null); setSyncError("");
    void refresh();
    const stop = watchOrderEvents({
      branchId, token, onReady: () => { void refresh(); },
      onChange: () => { void refresh(); },
    });
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void refresh();
    }, 10000);
    const subscription = AppState.addEventListener("change", state => {
      if (state === "active") void refresh();
    });
    return () => {
      sequence.current++; stop(); clearInterval(timer); subscription.remove();
    };
  }, [refresh, token, branchId]);

  const counts = {
    pending: orders.filter(order => order.status === "PENDING").length,
    preparing: orders.filter(order => ["CONFIRMED", "PREPARING"].includes(order.status)).length,
    ready: orders.filter(order => order.status === "READY").length,
  };
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
  const deliveredVnd = orders
    .filter(order => order.status === "DELIVERED"
      && new Date(order.updatedAt).toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }) === today)
    .reduce((sum, order) => sum + (order.totalVnd ?? 0), 0);
  const metrics: { label: string; value: string; icon: IconName; tone: string; text: string; target: Tab }[] = [
    { label: "Đơn mới", value: String(counts.pending), icon: "orders",
      tone: "#FFE6E9", text: c.redDeep, target: "orders" },
    { label: "Đang chuẩn bị", value: String(counts.preparing), icon: "kitchen",
      tone: "#FFF1D6", text: "#8A510B", target: "kitchen" },
    { label: "Chờ giao", value: String(counts.ready), icon: "delivery",
      tone: "#DDECFC", text: "#1A548B", target: "delivery" },
    { label: "Giá trị đã giao hôm nay", value: formatMoney(deliveredVnd), icon: "dashboard",
      tone: "#E3F5E8", text: "#167442", target: "delivery" },
  ];
  const pending = orders.filter(order => order.status === "PENDING")
    .sort((a,b) => a.createdAt.localeCompare(b.createdAt)).slice(0, 3);
  const confirm = async (order: StaffOrder) => {
    if (confirming) return;
    setConfirming(order.id);
    setSyncError("");
    try {
      await request("/admin/orders/" + branchId + "/" + order.id + "/status",
        token, "PATCH", { expectedStatus: "PENDING", toStatus: "CONFIRMED" });
      await refresh();
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Không xác nhận được đơn.");
      await refresh();
    } finally { setConfirming(null); }
  };
  return <View style={styles.overview}>
    <View style={styles.dashboardDateRow}>
      <Text style={styles.dashboardDate}>◷  {new Date().toLocaleDateString("vi-VN", {
        weekday: "long", day: "numeric", month: "long", year: "numeric",
      })}</Text>
      <Pressable style={styles.dashboardRefresh} accessibilityRole="button"
        accessibilityLabel="Làm mới tổng quan" onPress={() => void refresh()}>
        <Text style={styles.refreshText}>{lastSync
          ? "Cập nhật " + lastSync.toLocaleTimeString("vi-VN", {hour:"2-digit",minute:"2-digit"})
          : "Chưa đồng bộ"} ↻</Text>
      </Pressable>
    </View>
    {!!syncError && <Notice text={"Dữ liệu có thể đã cũ: " + syncError} error />}
    <View style={styles.dashboardGrid}>
      {metrics.map(metric => <Pressable key={metric.label}
        accessibilityRole="button" accessibilityLabel={metric.label + ": " + metric.value}
        onPress={() => onChangeTab(metric.target)}
        style={[styles.dashboardMetric, { backgroundColor: metric.tone }]}>
        <View style={styles.metricIcon}><Icon name={metric.icon} size={24} color={metric.text} /></View>
        <View style={styles.metricCopy}>
          <Text style={styles.metricLabel}>{metric.label}</Text>
          <Text style={[styles.metricValue, { color: metric.text }]} adjustsFontSizeToFit
            numberOfLines={1}>{loading ? "—" : metric.value}</Text>
        </View>
        <Text style={[styles.metricArrow,{color:metric.text}]}>›</Text>
      </Pressable>)}
    </View>
    <View style={styles.dashboardSectionHead}>
      <Text style={styles.dashboardSectionTitle}>Đơn mới cần xác nhận</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Xem tất cả đơn mới"
        onPress={() => onChangeTab("orders")}>
        <Text style={styles.dashboardLink}>Xem tất cả ({loading ? "—" : counts.pending})  ›</Text>
      </Pressable>
    </View>
    {loading ? <ActivityIndicator color={c.red} style={{ padding: 35 }} /> :
      pending.length === 0 ? <View style={styles.dashboardEmpty}>
        <Icon name="orders" color={c.secondary} size={31} />
        <Text style={styles.emptyTitle}>Chưa có đơn mới</Text>
        <Text style={styles.caption}>Đơn mới sẽ xuất hiện ở đây khi khách đặt thành công.</Text>
      </View> : pending.map(order => <View key={order.id} style={styles.dashboardOrder}>
        <View style={styles.dashboardOrderTop}>
          <Text style={styles.dashboardOrderId}>#{order.id.slice(0,8).toUpperCase()}</Text>
          <View style={styles.newPill}><Text style={styles.newPillText}>Mới</Text></View>
          <Text style={styles.orderDate}>{new Date(order.createdAt).toLocaleTimeString("vi-VN", {
            hour: "2-digit", minute: "2-digit",
          })}</Text>
        </View>
        <View style={styles.dashboardOrderItems}>
          <View style={styles.productMark}><Icon name="kitchen" color={c.red} size={26} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            {order.items.slice(0,2).map((item,i) => <Text key={i}
              style={styles.orderItemLine} numberOfLines={1}>{item.quantity} × {item.productName}</Text>)}
            {order.items.length > 2 && <Text style={styles.caption}>
              + {order.items.length - 2} món khác
            </Text>}
          </View>
          {order.totalVnd !== undefined &&
            <Text style={styles.orderMoney}>{formatMoney(order.totalVnd)}</Text>}
        </View>
        <View style={styles.dashboardOrderActions}>
          <Pressable accessibilityRole="button" onPress={() => onChangeTab("orders")}
            style={styles.orderSecondaryButton}><Text style={styles.orderSecondaryText}>
              Xem / từ chối
            </Text></Pressable>
          <Pressable accessibilityRole="button" disabled={confirming !== null}
            onPress={() => void confirm(order)} style={styles.orderPrimaryButton}>
            <Icon name="check" color={c.white} size={20} />
            <Text style={styles.orderPrimaryText}>
              {confirming === order.id ? "Đang xác nhận..." : "Xác nhận"}
            </Text>
          </Pressable>
        </View>
      </View>)}
    <Text style={styles.dashboardFootnote}>Số liệu từ API theo chi nhánh · Không dùng dữ liệu mẫu.
      Giá trị đã giao không đồng nghĩa tiền COD đã đối soát.</Text>
  </View>;
}

export default function AdminApp() {
  const [ready, setReady] = useState(false);
  const [sessionError, setSessionError] = useState("");
  const [loginUser, setLoginUser] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState<"login" | "request" | "reset">("login");
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryInfo, setRecoveryInfo] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [chimeEnabled, setChimeEnabled] = useState(false);
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [accessExpiresAt, setAccessExpiresAt] = useState(0);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [chooseBranch, setChooseBranch] = useState(false);
  const [createBranch, setCreateBranch] = useState(false);
  const [catalog, setCatalog] = useState<AdminCatalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [authError, setAuthError] = useState("");
  const [notice, setNotice] = useState("");
  const sessionGeneration = useRef(0);
  const renewing = useRef(false);
  const retryCount = useRef(0);
  const [retryAt, setRetryAt] = useState(0);

  useEffect(() => { void loadOrderChime().then(setChimeEnabled).catch(() => undefined); }, []);
  const changeChime = (enabled: boolean) => {
    setChimeEnabled(enabled);
    void saveOrderChime(enabled).catch(() => setChimeEnabled(!enabled));
  };

  const loadIdentity = useCallback(async (access: string) => {
    const user = await request<Principal>("/auth/me", access);
    // Branch membership can grant MANAGER even when the global role is CUSTOMER.
    // The backend enforces OWNER/MANAGER permissions for every Admin API.
    const available = await request<Branch[]>("/admin/orders/branches", access);
    if (available.length === 0 && user.role !== "OWNER") {
      throw new AdminApiError("Tài khoản chưa được cấp quyền quản trị chi nhánh.", 403);
    }
    setPrincipal(user);
    setBranches(available);
    setBranchId(old => old && available.some(b => b.id === old)
      ? old : (available[0]?.id ?? null));
    if (available[0]?.staffRole === "KITCHEN") setTab("kitchen");
  }, []);

  useEffect(() => {
    let live = true;
    const epoch = sessionGeneration.current;
    async function restore() {
      setReady(false);
      try {
        const current = await refreshSession();
        if (!live || epoch !== sessionGeneration.current || !current) return;
        await loadIdentity(current.accessToken);
        if (!live || epoch !== sessionGeneration.current) return;
        setToken(current.accessToken);
        setAccessExpiresAt(Date.now() + current.accessTokenExpiresInSeconds * 1000);
      } catch (error) {
        if (!live || epoch !== sessionGeneration.current) return;
        if (error instanceof AdminApiError && (error.status === 401 || error.status === 403)) {
          await forgetSession(null).catch(() => undefined);
          if (error.status === 403) setAuthError(error.message);
        } else setSessionError(error instanceof Error ? error.message : "Không thể khôi phục phiên.");
      } finally { if (live) setReady(true); }
    }
    void restore();
    return () => { live = false; };
  }, [loadIdentity]);

  async function login() {
    if (loginBusy) return;
    setLoginBusy(true); setAuthError(""); setNotice("");
    try {
      const tokens = await request<AuthTokens>("/auth/login", undefined, "POST",
        { username: loginUser.trim(), password: loginPassword });
      await loadIdentity(tokens.accessToken);
      await rememberSession(tokens.refreshToken);
      sessionGeneration.current++;
      retryCount.current = 0; setRetryAt(0);
      setToken(tokens.accessToken);
      setAccessExpiresAt(Date.now() + tokens.accessTokenExpiresInSeconds * 1000);
      setLoginPassword("");
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : "Đăng nhập không thành công.");
    } finally { setLoginBusy(false); }
  }

  async function submitRecovery() {
    if (recoveryBusy) return;
    setRecoveryBusy(true); setAuthError(""); setRecoveryInfo("");
    try {
      const email = recoveryEmail.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setAuthError("Email không hợp lệ."); return;
      }
      if (recoveryMode === "request") {
        await request("/auth/password/request-code", undefined, "POST", { email });
        setRecoveryMode("reset"); setRecoveryCode("");
        setRecoveryInfo("Nếu email đã đăng ký, mã sẽ gửi qua Resend. Kiểm tra cả thư rác.");
      } else {
        if (!/^[0-9]{6}$/.test(recoveryCode)) {
          setAuthError("Nhập mã email gồm đúng 6 số."); return;
        }
        if (recoveryPassword.length < 6 || recoveryPassword.length > 128) {
          setAuthError("Mật khẩu phải có 6–128 ký tự (OWNER tối thiểu 8)."); return;
        }
        await request("/auth/password/reset", undefined, "POST",
          { email, code: recoveryCode, password: recoveryPassword });
        setRecoveryMode("login"); setRecoveryPassword(""); setRecoveryCode("");
        setRecoveryInfo("Đổi mật khẩu thành công. Đăng nhập bằng tài khoản OWNER.");
      }
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : "Không xử lý được yêu cầu. Thử lại.");
    } finally { setRecoveryBusy(false); }
  }

  const renew = useCallback(async () => {
    if (!token || renewing.current || Date.now() < retryAt) return;
    renewing.current = true;
    const epoch = sessionGeneration.current;
    try {
      const next = await refreshSession();
      if (!next || epoch !== sessionGeneration.current) return;
      retryCount.current = 0;
      setRetryAt(0); setToken(next.accessToken);
      setAccessExpiresAt(Date.now() + next.accessTokenExpiresInSeconds * 1000);
    } catch (e) {
      if (epoch !== sessionGeneration.current) return;
      if (e instanceof AdminApiError && e.status === 401) {
        setToken(null); setPrincipal(null); setBranches([]);
        await forgetSession(null).catch(() => undefined);
        setAuthError("Phiên đã hết hạn. Vui lòng đăng nhập lại.");
      } else {
        const wait = Math.min(300000, 15000 * 2 ** Math.min(retryCount.current++, 5));
        setRetryAt(Date.now() + wait);
        setNotice("Mạng gián đoạn. Admin sẽ thử kết nối lại.");
      }
    } finally { renewing.current = false; }
  }, [token, retryAt]);

  useEffect(() => {
    if (!token) return;
    const scheduleAt = Math.max(retryAt, accessExpiresAt - 60_000);
    const timer = setTimeout(() => void renew(), Math.max(1000, scheduleAt - Date.now()));
    const subscription = AppState.addEventListener("change", state => {
      if (state === "active" && Date.now() >= scheduleAt) void renew();
    });
    return () => { clearTimeout(timer); subscription.remove(); };
  }, [token, accessExpiresAt, retryAt, renew]);

  const reload = useCallback(async () => {
    if (!token || !branchId || branches.find(b => b.id === branchId)?.staffRole === "KITCHEN") return;
    setLoading(true); setLoadError("");
    try {
      const data = await request<AdminCatalog>(
        "/admin/branches/" + branchId + "/catalog", token);
      setCatalog(data);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Không tải được thực đơn quản trị.");
      setCatalog(null);
    } finally { setLoading(false); }
  }, [token, branchId, branches]);

  useEffect(() => {
    setCatalog(null);
    if (token && branchId) void reload();
  }, [token, branchId, reload]);

  async function signOut() {
    sessionGeneration.current++;
    const old = token;
    setToken(null); setPrincipal(null); setCatalog(null);
    setBranches([]); setBranchId(null); setNotice(""); setAuthError("");
    setAccessExpiresAt(0); setRetryAt(0); retryCount.current = 0;
    await forgetSession(old).catch(() =>
      setAuthError("Đã đăng xuất trên thiết bị. Có thể chưa thu hồi được phiên trên máy chủ."));
  }

  const branchSaved = async (savedId: string, created: boolean) => {
    if (!token) return;
    const latest = await request<Branch[]>("/admin/branches", token);
    if (!latest.some(branch => branch.id === savedId)) {
      throw new Error("Đã lưu nhưng chưa tải lại được chi nhánh. Hãy thử tải lại.");
    }
    setBranches(latest);
    setBranchId(savedId);
    setCreateBranch(false);
    setChooseBranch(false);
    if (created) {
      setTab("settings");
      setNotice("Đã tạo chi nhánh. Mở Thiết lập để lưu giờ bán, phí giao và kích hoạt.");
    } else {
      setTab("settings");
      setNotice("Đã cập nhật chi nhánh.");
      if (savedId === branchId) await reload();
    }
  };
  const selectedBranch = branches.find(b => b.id === branchId);
  const branchRole = selectedBranch?.staffRole ?? principal?.role ?? "CUSTOMER";
  const kitchenOnly = branchRole === "KITCHEN";
  const visibleTabs = tabs.filter(item =>
    ["overview", "orders", "kitchen", "catalog", "delivery"].includes(item.id)
    && (!kitchenOnly || item.id === "kitchen"));
  return <SafeAreaProvider>
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <StatusBar barStyle={token ? "light-content" : "dark-content"}
        backgroundColor={token ? "#5B0A0E" : c.white} />
      {!ready ? <View style={styles.center}>
        <ActivityIndicator color={c.red} size="large" />
        <Text style={styles.caption}>Đang kiểm tra phiên quản trị...</Text>
      </View> : sessionError ? <View style={styles.center}>
        <Notice text={sessionError} error />
        <Action label="Thử kết nối lại" onPress={() => { setSessionError(""); setReady(false);
          // Reloading the document resets the boot hook; on Android a new session is restored via app restart.
          if (Platform.OS === "web") window.location.reload();
          else { setReady(true); setSessionError(""); }
        }} />
        <Action label="Đăng nhập lại" secondary onPress={() => {
          void forgetSession(null); setSessionError(""); setToken(null); setPrincipal(null);
        }} />
      </View> : !token ? <KeyboardAvoidingView style={styles.loginPage}
        behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.loginPanel}>
          <View style={styles.loginBrand}>
            <View style={styles.loginLogo}><Text style={styles.loginLogoText}>S</Text></View>
            <View style={styles.loginBrandText}>
              <Text style={styles.brandName}>SICHUAN HOTPOT</Text>
              <Text style={styles.brandSub}>Quản trị cửa hàng</Text>
            </View>
          </View>
          <Text style={styles.loginTitle}>{recoveryMode === "login" ? "Đăng nhập quản trị" :
            recoveryMode === "request" ? "Quên mật khẩu" : "Đặt lại mật khẩu"}</Text>
          <Text style={styles.caption}>{recoveryMode === "login"
            ? "Chỉ dành cho chủ cửa hàng và quản lý đã được cấp quyền."
            : "Xác minh qua email đã gắn với tài khoản quản trị."}</Text>
          {recoveryMode === "login" ? <>
            <Field label="Tên đăng nhập" value={loginUser} onChangeText={setLoginUser}
              placeholder="Tài khoản nhân viên" />
            <Field label="Mật khẩu" value={loginPassword} secure onChangeText={setLoginPassword}
              placeholder="Nhập mật khẩu" />
            {!!authError && <Notice text={authError} error />}
            {!!recoveryInfo && <Notice text={recoveryInfo} />}
            <Action label={loginBusy ? "Đang đăng nhập..." : "Đăng nhập"}
              disabled={loginBusy || !loginUser.trim() || !loginPassword}
              onPress={() => void login()} />
            <Action label="Quên mật khẩu?" secondary onPress={() => {
              setAuthError(""); setRecoveryInfo(""); setRecoveryMode("request");
            }} />
          </> : <>
            <Field label="Email khôi phục" value={recoveryEmail} onChangeText={setRecoveryEmail}
              placeholder="Email đã xác minh" />
            {recoveryMode === "reset" && <>
              <Field label="Mã xác minh (6 số)" value={recoveryCode} onChangeText={setRecoveryCode}
                placeholder="Nhập mã từ Gmail" numeric />
              <Field label="Mật khẩu mới" value={recoveryPassword} onChangeText={setRecoveryPassword}
                secure placeholder="OWNER: 8–128 ký tự" />
            </>}
            {!!authError && <Notice text={authError} error />}
            {!!recoveryInfo && <Notice text={recoveryInfo} />}
            <Action label={recoveryBusy ? "Đang xử lý..." :
              recoveryMode === "request" ? "Gửi mã qua email" : "Đổi mật khẩu"}
              disabled={recoveryBusy || !recoveryEmail.trim()} onPress={() => void submitRecovery()} />
            <Action label="Quay lại đăng nhập" secondary onPress={() => {
              setAuthError(""); setRecoveryInfo(""); setRecoveryPassword("");
              setRecoveryCode(""); setRecoveryMode("login");
            }} />
          </>}
        </View>
      </KeyboardAvoidingView> : <View style={styles.shell}>
        {branchId && <OrderAlertWatcher token={token} branchId={branchId}
          role={branchRole} chimeEnabled={chimeEnabled} />}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <Image source={require("./assets/app-icon.png")} style={styles.headerLogo}
              accessibilityLabel="Biểu tượng Lẩu Tứ Xuyên" />
            <View style={styles.headerText}>
              <Text style={styles.brandHeading} numberOfLines={2}>Lẩu Tứ Xuyên & Trà Sữa</Text>
              <Text style={styles.brandTagline} numberOfLines={2}>
                Quản lý đơn hàng · Vận hành cửa hàng
              </Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Mở thiết lập"
              onPress={() => { setChooseBranch(false); setTab("settings"); }}
              style={styles.heroAction}>
              <Icon name="settings" size={22} color="#F8E8D0" />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Mở tài khoản"
              onPress={() => { setChooseBranch(false); setTab("account"); }}
              style={styles.heroAction}>
              <Icon name="account" size={22} color="#F8E8D0" />
            </Pressable>
          </View>
          <View style={styles.headerBottom}>
            <Pressable accessibilityRole="button" accessibilityLabel="Đổi chi nhánh"
              style={styles.branchSelector} onPress={() => {
                if (branches.length) setChooseBranch(v => !v);
              }}>
              <Icon name="pin" color="#FCE3D0" size={23} />
              <View style={styles.branchCopy}>
                <Text style={styles.branchHint}>Chi nhánh</Text>
                <Text style={styles.branchText} numberOfLines={1}>
                  {selectedBranch?.name ?? "Chọn chi nhánh"}
                </Text>
              </View>
              <Text style={styles.branchArrow}>⌄</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Thiết lập hoạt động cửa hàng"
              onPress={() => { setChooseBranch(false); setTab("settings"); }}
              style={styles.operationPill}>
              <Icon name="store" color={selectedBranch?.isActive ? "#116837" : c.red} size={22} />
              <View style={styles.operationCopy}>
                <Text style={styles.operationText} numberOfLines={2}>
                  {selectedBranch?.isActive ? "Đang hoạt động" : "Chưa kích hoạt"}
                </Text>
                <Text style={styles.operationSub}>Trạng thái chi nhánh</Text>
              </View>
              <View style={[styles.operationDot,
                { backgroundColor: selectedBranch?.isActive ? "#0FA463" : c.red }]} />
            </Pressable>
          </View>
          {chooseBranch && <View style={styles.branchMenu}>
            {branches.map(branch => <Pressable key={branch.id} accessibilityRole="button"
              accessibilityLabel={"Chọn chi nhánh " + branch.name}
              style={styles.branchItem} onPress={() => {
                setBranchId(branch.id); setChooseBranch(false);
                setTab(branch.staffRole === "KITCHEN" ? "kitchen" : "overview");
              }}>
              <Text style={styles.branchItemText}>{branch.name}</Text>
              {branch.id === branchId && <Text style={styles.selectedMark}>✓</Text>}
            </Pressable>)}
          </View>}
        </View>
        <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {!!notice && <View style={styles.pagePadding}><Notice text={notice} /></View>}
          {branches.length === 0 ? <View style={styles.bootstrap}>
            {principal?.role === "OWNER" ? <>
              <Text style={styles.bootstrapTitle}>Khởi tạo cửa hàng đầu tiên</Text>
              <Text style={styles.caption}>Chưa có chi nhánh. Tạo cửa hàng thật bằng địa chỉ và tọa độ giao hàng. Chi nhánh chưa mở bán cho đến khi cấu hình đầy đủ.</Text>
              {createBranch ? <BranchPanel token={token} onSaved={branchSaved}
                onCancel={() => setCreateBranch(false)} /> :
                <Action label="Tạo chi nhánh đầu tiên" onPress={() => setCreateBranch(true)} />}
            </> : <Notice error text="Tài khoản chưa được cấp quyền quản lý chi nhánh nào." />}
          </View> : (tab === "orders" || tab === "kitchen" || tab === "delivery") && branchId ?
            <OrderQueuePanel key={branchId + ":" + tab} token={token} branchId={branchId}
              role={branchRole} mode={tab} active chimeEnabled={chimeEnabled} /> :
            tab === "account" ? <View style={styles.account}>
              <Text style={styles.sectionTitle}>Tài khoản quản trị</Text>
              <Text style={styles.rowTitle}>{roleName(branchRole)}</Text>
              <Text style={styles.caption}>Dữ liệu được phân quyền theo chi nhánh tại backend.</Text>
              <Action label="Đăng xuất" dangerous onPress={() => void signOut()} />
            </View> : loading && !catalog ? <View style={styles.center}>
            <ActivityIndicator color={c.red} />
            <Text style={styles.caption}>Đang tải dữ liệu chi nhánh...</Text>
          </View> : loadError || !catalog ? <View style={styles.center}>
            <Notice text={loadError || "Không tìm thấy dữ liệu chi nhánh."} error />
            <Action label="Tải lại" onPress={() => void reload()} />
          </View> : (
            <>
              {tab === "overview" && <Overview catalog={catalog} token={token} branchId={branchId!} onChangeTab={setTab} />}
              {tab === "catalog" && <CatalogPanel catalog={catalog} token={token} reload={reload} />}
              {tab === "settings" && selectedBranch && <SettingsHub
                token={token} branch={selectedBranch} catalog={catalog}
                owner={principal?.role === "OWNER"} reload={reload}
                onBranchSaved={branchSaved} chimeEnabled={chimeEnabled}
                onChimeChange={changeChime} />}
            </>
          )}
        </ScrollView>
        <View style={styles.bottomTabs}>
          {visibleTabs.map(item => <Pressable key={item.id}
            accessibilityRole="tab" accessibilityLabel={item.label}
            accessibilityState={{ selected: tab === item.id }}
            style={[styles.tab, tab === item.id && styles.tabSelected]}
            onPress={() => { setChooseBranch(false); setTab(item.id); }}>
            <Icon name={item.icon} size={26} color={tab === item.id ? "#FFD58A" : "#FAF1E6"} />
            <Text style={[styles.tabLabel, tab === item.id && styles.tabActive]}>{item.shortLabel}</Text>
          </Pressable>)}
        </View>
      </View>}
    </SafeAreaView>
  </SafeAreaProvider>;
}
const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#5B0A0E" },
  shell: { flex: 1, width: "100%", maxWidth: 1080, alignSelf: "center",
    backgroundColor: c.white, overflow: "hidden" },
  center: { flex: 1, justifyContent: "center", alignItems: "stretch",
    paddingHorizontal: 24, gap: 16, minHeight: 150 },
  caption: { fontSize: font.note, color: c.secondary, lineHeight: 18 },
  sectionTitle: { color: c.ink, fontSize: font.section, fontWeight: "800" },
  rowTitle: { color: c.ink, fontSize: font.body, fontWeight: "700" },
  loginPage: { flex: 1, alignItems: "center", justifyContent: "center",
    paddingHorizontal: 20, backgroundColor: c.white },
  loginPanel: { width: "100%", maxWidth: 410, gap: 14 },
  loginBrand: { flexDirection: "row", alignItems: "center", gap: 10,
    paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: c.line },
  loginLogo: { width: 40, height: 40, borderRadius: 10, alignItems: "center",
    justifyContent: "center", backgroundColor: c.red },
  loginLogoText: { color: c.white, fontSize: 20, fontWeight: "800" },
  loginBrandText: { flex: 1 },
  brandName: { color: c.red, fontSize: font.section, fontWeight: "900", letterSpacing: 0.3 },
  brandSub: { color: c.secondary, fontSize: font.caption, marginTop: 3 },
  loginTitle: { color: c.ink, fontSize: font.title, fontWeight: "800" },
  header: { backgroundColor: "#650D11", borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22, overflow: "hidden" },
  headerTop: { flexDirection: "row", alignItems: "center",
    gap: 10, paddingHorizontal: 13, paddingTop: 16, paddingBottom: 15, minHeight: 90 },
  headerText: { flex: 1, minWidth: 0 },
  branchSelector: { flex: 1.3, minWidth: 0, minHeight: 64,
    flexDirection: "row", alignItems: "center", paddingHorizontal: 10,
    borderRadius: 13, borderWidth: 1, borderColor: "#A84B49",
    backgroundColor: "#7C201E", gap: 7 },
  branchText: { flexShrink: 1, fontSize: 12, color: c.white, fontWeight: "800", marginTop: 2 },
  branchArrow: { fontSize: 21, color: c.white },
  branchMenu: { borderTopWidth: 1, borderTopColor: "#A84B49", paddingHorizontal: 14 },
  branchItem: { minHeight: 44, flexDirection: "row", justifyContent: "space-between",
    alignItems: "center", borderBottomWidth: 1, borderBottomColor: "#A84B49" },
  branchItemText: { fontSize: font.body, color: c.white },
  selectedMark: { color: "#FFD58A", fontSize: font.body, fontWeight: "800" },
  scroll: { flex: 1, minHeight: 0 },
  scrollContent: { paddingBottom: 22, flexGrow: 1 },
  pagePadding: { padding: 12 },
  bottomTabs: { flexDirection: "row", borderTopWidth: 1,
    borderTopColor: "#8D3434", backgroundColor: "#420707", paddingBottom: 7,
    paddingTop: 6, paddingHorizontal: 6 },
  tab: { flex: 1, minWidth: 0, minHeight: 56, alignItems: "center",
    justifyContent: "center", borderRadius: 13, gap: 3 },
  tabSelected: { backgroundColor: "#6E351B" },
  tabLabel: { color: "#FAF1E6", fontSize: 11, fontWeight: "700" },
  tabActive: { color: "#FFD58A" },
  overview: { paddingHorizontal: 13, paddingTop: 12, paddingBottom: 24, gap: 12 },
  stats: { flexDirection: "row", gap: 8, marginVertical: 6 },
  stat: { flex: 1, minHeight: 73, paddingHorizontal: 10,
    borderRightWidth: 1, borderRightColor: c.line, justifyContent: "center", gap: 5 },
  statNumber: { color: c.ink, fontSize: 17, fontWeight: "800" },
  statLabel: { color: c.secondary, fontSize: font.caption },
  overviewList: { paddingTop: 10, gap: 6 },
  overviewRow: { minHeight: 66, flexDirection: "row", alignItems: "center",
    borderBottomWidth: 1, borderBottomColor: c.line, gap: 10 },
  overviewCopy: { flex: 1, gap: 5 },
  chevron: { color: c.secondary, fontSize: 22 },
  account: { padding: 15, gap: 12 },
  bootstrap: { padding: 16, gap: 14, flexGrow: 1, justifyContent: "center" },
  bootstrapTitle: { color: c.ink, fontSize: font.title, fontWeight: "800" },
  brandHeading: { color: "#FFF8EE", fontSize: 19, lineHeight: 25, fontWeight: "800" },
  brandTagline: { color: "#F5CFC6", fontSize: 11, lineHeight: 15, marginTop: 3 },
  headerLogo: { width: 53, height: 53, borderRadius: 27, borderWidth: 1.5,
    borderColor: "#EAC17C", backgroundColor: "#7E1317" },
  heroAction: { height: 44, width: 36, alignItems: "center", justifyContent: "center" },
  headerBottom: { flexDirection: "row", paddingHorizontal: 12,
    paddingBottom: 16, gap: 9, alignItems: "stretch" },
  branchCopy: { flex: 1, minWidth: 0 },
  branchHint: { color: "#F7C9BD", fontSize: 10 },
  operationPill: { flex: 1, minHeight: 64, paddingHorizontal: 10, gap: 5,
    flexDirection: "row", borderRadius: 13, backgroundColor: "#FFF2DD",
    alignItems: "center" },
  operationCopy: { flex: 1, minWidth: 0 },
  operationText: { fontSize: 12, fontWeight: "800", color: "#512C1B" },
  operationSub: { color: "#986E49", fontSize: 9, marginTop: 2 },
  operationDot: { width: 12, height: 12, borderRadius: 8 },
  dashboardDateRow: { flexDirection: "row", justifyContent: "space-between",
    gap: 5, alignItems: "center", paddingVertical: 5 },
  dashboardDate: { flex: 1, fontSize: 12, color: c.ink, fontWeight: "600" },
  dashboardRefresh: { minHeight: 44, justifyContent: "center", paddingLeft: 6 },
  refreshText: { color: c.secondary, fontSize: 10 },
  dashboardGrid: { flexDirection: "row", flexWrap: "wrap",
    justifyContent: "space-between", rowGap: 10, columnGap: 10 },
  dashboardMetric: { width: "48%", minHeight: 100, borderRadius: 14,
    flexDirection: "row", alignItems: "center", padding: 12, gap: 9 },
  metricIcon: { width: 44, height: 44, borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.5)", alignItems: "center", justifyContent: "center" },
  metricCopy: { flex: 1, gap: 5, minWidth: 0 },
  metricLabel: { fontSize: 11, lineHeight: 16, color: "#3D3333" },
  metricValue: { fontSize: 19, lineHeight: 25, fontWeight: "900" },
  metricArrow: { fontSize: 22, fontWeight: "600" },
  dashboardSectionHead: { marginTop: 8, minHeight: 47,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  dashboardSectionTitle: { color: c.ink, fontSize: 16, fontWeight: "900",
    borderLeftColor: c.red, borderLeftWidth: 4, paddingLeft: 10, flexShrink: 1 },
  dashboardLink: { color: c.secondary, fontSize: 11 },
  dashboardEmpty: { padding: 30, borderRadius: 16, backgroundColor: "#FFFDFB",
    borderWidth: 1, borderColor: "#F1E6E0", alignItems: "center", gap: 10 },
  emptyTitle: { color: c.ink, fontSize: 14, fontWeight: "800" },
  dashboardOrder: { padding: 13, borderWidth: 1, borderColor: "#EFE5DD",
    backgroundColor: c.white, borderRadius: 15, gap: 11,
    shadowColor: "#462320", shadowOpacity: 0.08, shadowRadius: 8, elevation: 2 },
  dashboardOrderTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  dashboardOrderId: { fontSize: 17, fontWeight: "900", color: "#241A1A" },
  newPill: { backgroundColor: "#FFE4E7", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 5 },
  newPillText: { color: c.red, fontSize: 11, fontWeight: "800" },
  orderDate: { flex: 1, textAlign: "right", color: c.secondary, fontSize: 11 },
  dashboardOrderItems: { flexDirection: "row", alignItems: "center", gap: 11 },
  productMark: { height: 55, width: 55, borderRadius: 12,
    backgroundColor: "#FFF1D9", alignItems: "center", justifyContent: "center" },
  orderItemLine: { fontSize: 12, lineHeight: 18, color: c.ink, fontWeight: "600" },
  orderMoney: { fontSize: 15, fontWeight: "900", color: c.red, flexShrink: 0 },
  dashboardOrderActions: { flexDirection: "row", gap: 10 },
  orderSecondaryButton: { flex: 1, minHeight: 44, borderRadius: 9,
    backgroundColor: "#FCE5E5", alignItems: "center", justifyContent: "center" },
  orderSecondaryText: { color: c.red, fontWeight: "800", fontSize: 12 },
  orderPrimaryButton: { flex: 1, minHeight: 44, borderRadius: 9,
    backgroundColor: c.redDeep, flexDirection: "row", alignItems: "center",
    justifyContent: "center", gap: 7 },
  orderPrimaryText: { color: c.white, fontWeight: "800", fontSize: 12 },
  dashboardFootnote: { color: c.secondary, fontSize: 10, lineHeight: 16, marginTop: 7 },
});
