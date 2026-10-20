import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, AppState, Image, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StatusBar, StyleSheet, Text, View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import {
  AdminApiError, forgetSession, refreshSession, rememberSession, request,
  setAdminSessionRecovery,
  type AdminCatalog, type AuthTokens, type Branch, type Principal,
} from "./src/api";
import { CatalogPanel } from "./src/CatalogPanel";
import { StatusSwitch } from "./src/StatusSwitch";
import { BranchPanel } from "./src/BranchPanel";
import { SettingsHub } from "./src/SettingsHub";
import { OrderQueuePanel, type OrderGroup, type HistoryStatusFilter, type StaffOrder } from "./src/OrderQueuePanel";
import { watchOrderEvents } from "./src/order-realtime";
import { loadOrderChime, saveOrderChime } from "./src/order-notifications";
import {
  configureAdminNotificationPresentation, disableAdminPush, enableAdminPush,
  refreshAdminPushIfEnabled, watchAdminNotificationResponses,
} from "./src/push-client";
import { Icon, type IconName } from "./src/Icon";
import { Action, Field, Notice } from "./src/ui";
import { c, font } from "./src/theme";
import { adminDensity } from "./src/density";
import { AdminPwaReleaseNotice } from "./src/AdminPwaReleaseNotice";
import { ALL_HISTORY, historyPeriodRange, type HistoryRange } from "./src/history-search";
import { BusinessReportPanel, type ReportMetric } from "./src/BusinessReportPanel";

type Tab = "overview" | "orders" | "kitchen" | "catalog" | "delivery" | "settings" | "account" | "report" | "lookup";
const tabs: { id: Tab; label: string; shortLabel: string; icon: IconName }[] = [
  { id: "overview", label: "Tổng quan", shortLabel: "Tổng quan", icon: "dashboard" },
  { id: "orders", label: "Đơn hàng", shortLabel: "Đơn", icon: "orders" },
  { id: "kitchen", label: "Bếp", shortLabel: "Bếp", icon: "kitchen" },
  { id: "catalog", label: "Thực đơn", shortLabel: "Món", icon: "catalog" },
  { id: "delivery", label: "Giao hàng", shortLabel: "Giao", icon: "delivery" },
  { id: "settings", label: "Quản lý", shortLabel: "Quản lý", icon: "manage" },
  { id: "account", label: "Tài khoản", shortLabel: "Tài khoản", icon: "account" },
];
function roleName(role: string): string {
  return role === "OWNER" ? "Chủ cửa hàng" : role === "KITCHEN" ? "Nhân viên bếp" :
    role === "DRIVER" ? "Nhân viên giao hàng" : "Quản lý chi nhánh";
}
const formatMoney = (value: number): string => value.toLocaleString("vi-VN") + "đ";

type DailyOverviewSummary = {
  date: string;
  pending: number;
  preparing: number;
  ready: number;
  deliveredCount: number;
  canceledCount: number;
  deliveredValueVnd: number;
  confirmedPaymentVnd: number;
};

function Overview({ catalog, token, branchId, onChangeTab, onOpenKpi, onOpenReport }: {
  catalog: AdminCatalog; token: string; branchId: string;
  onChangeTab: (tab: Tab) => void;
  onOpenKpi: (kind: "NEW" | "CANCELED" | "DELIVERED" | "REVENUE") => void;
  onOpenReport: () => void;
}) {
  const [orders, setOrders] = useState<StaffOrder[]>([]);
  const [summary, setSummary] = useState<DailyOverviewSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncError, setSyncError] = useState("");
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<StaffOrder | null>(null);
  const sequence = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++sequence.current;
    try {
      const [figures, firstPage] = await Promise.all([
        request<DailyOverviewSummary>("/admin/orders/" + branchId + "/summary", token),
        request<{ items: StaffOrder[] }>(
          "/admin/orders/" + branchId + "/pages?group=new&limit=3", token),
      ]);
      if (id !== sequence.current) return;
      setOrders(firstPage.items);
      setSummary(figures);
      setSyncError("");
      setLastSync(new Date());
    } catch (error) {
      if (id === sequence.current) {
        setOrders([]);
        setSummary(null);
        setLastSync(null);
        setSyncError(error instanceof Error ? error.message : "Không đồng bộ được đơn.");
      }
    } finally {
      if (id === sequence.current) setLoading(false);
    }
  }, [branchId, token]);

  useEffect(() => {
    setOrders([]); setSummary(null); setLoading(true); setLastSync(null); setSyncError("");
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
    pending: summary?.pending ?? 0,
    preparing: summary?.preparing ?? 0,
    ready: summary?.ready ?? 0,
  };
  const metrics: { label: string; value: string; icon: IconName; tone: string;
    text: string; kind: "NEW" | "CANCELED" | "DELIVERED" | "REVENUE" }[] = [
    { label: "Đơn mới", value: String(counts.pending), icon: "orders",
      tone: "#FFE6E9", text: c.redDeep, kind: "NEW" },
    { label: "Đã hủy hôm nay", value: String(summary?.canceledCount ?? 0), icon: "close",
      tone: "#FBE7E6", text: "#A33137", kind: "CANCELED" },
    { label: "Đã giao hôm nay", value: String(summary?.deliveredCount ?? 0), icon: "delivery",
      tone: "#DDECFC", text: "#1A548B", kind: "DELIVERED" },
    { label: "Giá trị giao hôm nay", value: formatMoney(summary?.deliveredValueVnd ?? 0), icon: "report",
      tone: "#E3F5E8", text: "#167442", kind: "REVENUE" },
  ];
  const pending = orders;
  const confirm = async (order: StaffOrder) => {
    if (confirming) return;
    setConfirming(order.id);
    setSyncError("");
    try {
      await request("/admin/orders/" + branchId + "/" + order.id + "/status",
        token, "PATCH", { expectedStatus: "PENDING", toStatus: "CONFIRMED" });
      setConfirmTarget(null);
      await refresh();
    } catch (error) {
      setSyncError((error instanceof Error ? error.message : "Không xác nhận được đơn.")
        + " Danh sách được làm mới để tránh xử lý trạng thái cũ.");
      setConfirmTarget(null);
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
        onPress={() => onOpenKpi(metric.kind)}
        style={[styles.dashboardMetric, { backgroundColor: metric.tone }]}>
        <View style={styles.metricIcon}><Icon name={metric.icon} size={21} color={metric.text} /></View>
        <View style={styles.metricCopy}>
          <Text style={styles.metricLabel} numberOfLines={2}>{metric.label}</Text>
          <Text style={[styles.metricValue, { color: metric.text }]} adjustsFontSizeToFit
            numberOfLines={1}>{loading || !summary ? "—" : metric.value}</Text>
        </View>
        <Text style={[styles.metricArrow,{color:metric.text}]}>›</Text>
      </Pressable>)}
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel="Mở báo cáo kinh doanh"
      onPress={onOpenReport} style={styles.reportLink}>
      <Icon name="dashboard" color={c.redDeep} size={21} />
      <Text style={styles.reportLinkText}>Báo cáo kinh doanh</Text>
      <Text style={styles.reportLinkArrow}>›</Text>
    </Pressable>
    <View style={styles.dashboardSectionHead}>
      <Text style={styles.dashboardSectionTitle}>Đơn mới cần xác nhận</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Xem tất cả đơn mới"
        onPress={() => onChangeTab("orders")}>
        <Text style={styles.dashboardLink}>Xem tất cả ({loading ? "—" : counts.pending})  ›</Text>
      </Pressable>
    </View>
    {loading ? <ActivityIndicator color={c.red} style={{ padding: 35 }} /> :
      pending.length === 0 ? <View style={styles.dashboardEmpty}>
        <Icon name="orders" color={c.secondary} size={24} />
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
          <View style={styles.productMark}><Icon name="kitchen" color={c.red} size={22} /></View>
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
            onPress={() => setConfirmTarget(order)} style={styles.orderPrimaryButton}>
            <Icon name="check" color={c.white} size={20} />
            <Text style={styles.orderPrimaryText}>
              Xác nhận
            </Text>
          </Pressable>
        </View>
      </View>)}
    <Modal visible={!!confirmTarget} transparent animationType="fade"
      onRequestClose={() => { if (!confirming) setConfirmTarget(null); }}>
      <View style={styles.confirmOverlay}>
        <View style={styles.confirmSheet}>
          <Text style={styles.sectionTitle}>Xác nhận nhận đơn?</Text>
          <Text style={styles.caption}>
            {confirmTarget ? "Đơn #" + confirmTarget.id.slice(0, 8).toUpperCase() : ""}
            {" · Chỉ xác nhận đơn đang Mới. Hành động được ghi lịch sử."}
          </Text>
          <Action label={confirming ? "Đang xác nhận..." : "Xác nhận đơn"}
            disabled={!!confirming || !confirmTarget}
            onPress={() => { if (confirmTarget) void confirm(confirmTarget); }} />
          <Action secondary label="Quay lại" disabled={!!confirming}
            onPress={() => setConfirmTarget(null)} />
        </View>
      </View>
    </Modal>
    <Text style={styles.dashboardFootnote}>Tính theo giờ Việt Nam, dựa trên lúc giao thành công.
      {summary ? "\nThanh toán đã xác nhận trong đơn giao hôm nay: "
        + formatMoney(summary.confirmedPaymentVnd) + "." : ""}
      {"\n"}Giá trị đơn đã giao không đồng nghĩa tiền thực thu; QR đang chờ xác nhận
      và khoản hoàn tiền không tính là đã thu.</Text>
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
  const [chimePending, setChimePending] = useState(true);
  const [chimeError, setChimeError] = useState("");
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [accessExpiresAt, setAccessExpiresAt] = useState(0);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [chooseBranch, setChooseBranch] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [createBranch, setCreateBranch] = useState(false);
  const [catalog, setCatalog] = useState<AdminCatalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  // Parent-owned: switching between bottom tabs must not reset order sub-filter.
  const [orderGroup, setOrderGroup] = useState<OrderGroup>("new");
  // History is a separate screen, not a sixth operating tab. Keep the last
  // working lane so Back always returns to the operator's previous position.
  const lastWorkingLane = useRef<Exclude<OrderGroup, "history">>("new");
  const [historyStatus, setHistoryStatus] = useState<HistoryStatusFilter>("ALL");
  const [historyRange, setHistoryRange] = useState<HistoryRange>(ALL_HISTORY);
  const [historyCode, setHistoryCode] = useState("");
  const [reportRange, setReportRange] = useState<HistoryRange>(
    () => historyPeriodRange("week"));
  const [reportMetric, setReportMetric] = useState<ReportMetric | null>(null);
  const [reportBack, setReportBack] = useState<"overview" | "settings">("overview");
  const [lookupRange, setLookupRange] = useState<HistoryRange>(() => historyPeriodRange("week"));
  const [lookupCode, setLookupCode] = useState("");
  const [authError, setAuthError] = useState("");
  const [notice, setNotice] = useState("");
  const [headerBusy, setHeaderBusy] = useState(false);
  const [headerToast, setHeaderToast] = useState("");
  const sessionGeneration = useRef(0);
  const liveAccess = useRef<string | null>(null);
  const accessRecovery = useRef<Promise<string | null> | null>(null);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const renewing = useRef(false);
  const retryCount = useRef(0);
  const [retryAt, setRetryAt] = useState(0);

  const chimeLock = useRef(false);
  useEffect(() => {
    let mounted = true;
    void loadOrderChime()
      .then(value => { if (mounted) setChimeEnabled(value); })
      .catch(() => { if (mounted) setChimeError("Không đọc được thiết lập chuông trên thiết bị."); })
      .finally(() => { if (mounted) setChimePending(false); });
    return () => { mounted = false; };
  }, []);
  const changeChime = (enabled: boolean) => {
    if (chimeLock.current || chimePending) return;
    if (!token || !branchId) {
      setChimeError("Chưa có phiên quản trị hoặc chi nhánh để đăng ký thông báo.");
      return;
    }
    chimeLock.current = true;
    setChimePending(true); setChimeError("");
    void (async () => {
      if (enabled) await enableAdminPush(token, branchId);
      else await disableAdminPush(token);
      await saveOrderChime(enabled);
      setChimeEnabled(enabled);
    })()
      .catch(error => setChimeError(error instanceof Error
        ? error.message : "Không cấu hình được thông báo trên thiết bị."))
      .finally(() => { chimeLock.current = false; setChimePending(false); });
  };

  useEffect(() => {
    void configureAdminNotificationPresentation().catch(() => undefined);
    let stop: (() => void) | undefined;
    void watchAdminNotificationResponses(() => {
      setChooseBranch(false);
      setTab("orders");
    }).then(dispose => { stop = dispose; }).catch(() => undefined);
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const params = new URL(window.location.href).searchParams;
      if (params.get("notification") === "orders" || params.get("order")) setTab("orders");
    }
    return () => { stop?.(); };
  }, []);

  useEffect(() => {
    if (!token || !branchId || !chimeEnabled) return;
    void refreshAdminPushIfEnabled(token, branchId, true)
      .catch(error => setChimeError(error instanceof Error ? error.message : "Không làm mới được đăng ký thông báo."));
  }, [token, branchId, chimeEnabled]);

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
    else if (available[0]?.staffRole === "DRIVER") setTab("delivery");
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
        liveAccess.current = current.accessToken;
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
  }, [loadIdentity, restoreAttempt]);

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
      liveAccess.current = tokens.accessToken;
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

  // One recovery path for proactive rotation, stale WebSocket polling and 401 API replies.
  const recoverAccess = useCallback(async (stale: string): Promise<string | null> => {
    if (!liveAccess.current) return null; // logout must never reanimate a session
    if (liveAccess.current !== stale) return liveAccess.current;
    if (accessRecovery.current) return accessRecovery.current;
    const epoch = sessionGeneration.current;
    const task = (async () => {
      const next = await refreshSession();
      if (!next || epoch !== sessionGeneration.current) return null;
      liveAccess.current = next.accessToken;
      setToken(next.accessToken);
      setAccessExpiresAt(Date.now() + next.accessTokenExpiresInSeconds * 1000);
      retryCount.current = 0; setRetryAt(0);
      setNotice("");
      return next.accessToken;
    })();
    accessRecovery.current = task;
    try { return await task; }
    finally { if (accessRecovery.current === task) accessRecovery.current = null; }
  }, []);

  useEffect(() => {
    if (!token) return;
    return setAdminSessionRecovery(recoverAccess);
  }, [token, recoverAccess]);

  const renew = useCallback(async () => {
    if (!token || renewing.current || Date.now() < retryAt) return;
    renewing.current = true;
    const epoch = sessionGeneration.current;
    try {
      const nextAccess = await recoverAccess(token);
      if (!nextAccess && epoch === sessionGeneration.current) {
        // Refresh secret is missing/unreadable. Clear only live authentication,
        // preserving orders, settings and other local app data.
        liveAccess.current = null;
        setToken(null); setPrincipal(null); setBranches([]); setCatalog(null);
        setAccessExpiresAt(0); setRetryAt(0); retryCount.current = 0;
        setNotice("");
        setAuthError("Phiên đăng nhập trên thiết bị không còn đọc được. Vui lòng đăng nhập lại.");
      }
    } catch (e) {
      if (epoch !== sessionGeneration.current) return;
      if (e instanceof AdminApiError && e.status === 401) {
        liveAccess.current = null;
        setToken(null); setPrincipal(null); setBranches([]);
        await forgetSession(null).catch(() => undefined);
        setAuthError("Phiên thực sự không còn hợp lệ. Vui lòng đăng nhập lại.");
      } else {
        const wait = Math.min(300000, 15000 * 2 ** Math.min(retryCount.current++, 5));
        setRetryAt(Date.now() + wait);
        setNotice("Mạng gián đoạn. Admin sẽ thử kết nối lại.");
      }
    } finally { renewing.current = false; }
  }, [token, retryAt, recoverAccess]);

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
      throw e;
    } finally { setLoading(false); }
  }, [token, branchId, branches]);

  useEffect(() => {
    setCatalog(null);
    if (token && branchId) void reload().catch(() => undefined);
  }, [token, branchId, reload]);

  async function signOut() {
    sessionGeneration.current++;
    const old = token;
    liveAccess.current = null;
    if (old) await disableAdminPush(old).catch(() => undefined);
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
      setNotice("Đã tạo chi nhánh. Mở Quản lý để lưu giờ bán, phí giao và kích hoạt.");
    } else {
      setTab("settings");
      setNotice("Đã cập nhật chi nhánh.");
      if (savedId === branchId) await reload();
    }
  };
  useEffect(() => {
    if (!headerToast) return;
    const timer = setTimeout(() => setHeaderToast(""), 4200);
    return () => clearTimeout(timer);
  }, [headerToast]);

  async function toggleBranchActive(next: boolean) {
    if (!branchId || !token || headerBusy) return;
    const current = branches.find(item => item.id === branchId);
    const role = current?.staffRole ?? principal?.role;
    if (role !== "OWNER" && role !== "MANAGER") return;
    setHeaderBusy(true);
    setHeaderToast("");
    try {
      const updated = await request<Branch>(
        "/admin/branches/" + branchId + "/activation", token, "PATCH", { isActive: next });
      setBranches(prev => prev.map(item => item.id === updated.id
        ? { ...item, isActive: updated.isActive } : item));
      await reload();
    } catch (error) {
      setHeaderToast(error instanceof Error ? error.message : "Không thay đổi được trạng thái cửa hàng.");
    } finally { setHeaderBusy(false); }
  }

  const selectedBranch = branches.find(b => b.id === branchId);
  const branchRole = selectedBranch?.staffRole ?? principal?.role ?? "CUSTOMER";
  const kitchenOnly = branchRole === "KITCHEN";
  const driverOnly = branchRole === "DRIVER";
  const operator = branchRole === "OWNER" || branchRole === "MANAGER";
  const visibleTabs = tabs.filter(item => driverOnly ? item.id === "delivery"
    : kitchenOnly ? item.id === "kitchen"
    : ["overview", "orders", "kitchen", "catalog", "delivery"].includes(item.id));
  return <SafeAreaProvider>
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <StatusBar barStyle={token ? "light-content" : "dark-content"}
        backgroundColor={token ? "#5B0A0E" : c.white} />
      {!ready ? <View style={styles.center}>
        <ActivityIndicator color={c.red} size="large" />
        <Text style={styles.caption}>Đang kiểm tra phiên quản trị...</Text>
      </View> : sessionError ? <View style={styles.center}>
        <Notice text={sessionError} error />
        <Action label="Thử kết nối lại" onPress={() => {
          setSessionError(""); setRestoreAttempt(n => n + 1);
        }} />
        <Action label="Đăng nhập lại" secondary onPress={() => {
          sessionGeneration.current++;
          liveAccess.current = null;
          void forgetSession(null); setSessionError(""); setToken(null); setPrincipal(null);
        }} />
      </View> : !token ? <KeyboardAvoidingView style={styles.loginPage}
        behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.loginPanel}>
          <View style={styles.loginBrand}>
            <Image source={require("./assets/app-icon.png")} style={styles.loginLogo}
              accessibilityLabel="Logo Sichuan Hotpot" />
            <View style={styles.loginBrandText}>
              <Text style={styles.brandName}>HOTPOT</Text>
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
        <View style={styles.header} onLayout={event => setHeaderHeight(event.nativeEvent.layout.height)}>
          <View style={styles.headerTop}>
            <Image source={require("./assets/app-icon.png")} style={styles.headerLogo}
              accessibilityLabel="Biểu tượng Lẩu Tứ Xuyên" />
            <View style={styles.headerText}>
              <Text style={styles.brandHeading} numberOfLines={2}>Lẩu Tứ Xuyên & Trà Sữa</Text>
              <Text style={styles.brandTagline} numberOfLines={2}>
                Quản lý đơn hàng · Vận hành cửa hàng
              </Text>
            </View>
            {operator && <Pressable accessibilityRole="button" accessibilityLabel="Mở Quản lý"
              onPress={() => { setChooseBranch(false); setTab("settings"); }}
              style={styles.heroAction}>
              <Icon name="manage" size={22} color="#F8E8D0" />
            </Pressable>}
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
              <Icon name="pin" color="#FCE3D0" size={20} />
              <View style={styles.branchCopy}>
                <Text style={styles.branchHint}>Chi nhánh</Text>
                <Text style={styles.branchText} numberOfLines={1}>
                  {selectedBranch?.name ?? "Chọn chi nhánh"}
                </Text>
              </View>
              <Text style={styles.branchArrow}>⌄</Text>
            </Pressable>
            <View style={styles.operationPill}>
              <Icon name="store" color={selectedBranch?.isActive ? "#116837" : c.red} size={19} />
              <View style={styles.operationCopy}>
                <Text style={styles.operationText} numberOfLines={1}>
                  {selectedBranch?.isActive ? "Đang mở" : "Chưa mở"}
                </Text>
                <Text style={styles.operationSub}>Chi nhánh</Text>
              </View>
              <StatusSwitch label="Mở hoặc tắt chi nhánh" value={!!selectedBranch?.isActive}
                busy={headerBusy} disabled={!selectedBranch || kitchenOnly ||
                  (branchRole !== "OWNER" && branchRole !== "MANAGER")}
                hint="Chỉ bật tắt chi nhánh, không thay đổi chính sách nhận đơn và phí giao"
                onValueChange={next => { setChooseBranch(false); void toggleBranchActive(next); }} />
            </View>
          </View>
        </View>
        {!!headerToast && <View pointerEvents="none" style={[styles.headerToastLayer,
          { top: headerHeight + 4 }]}><Notice text={headerToast} error /></View>}
        {tab === "catalog" && catalog && branches.length > 0 && !loadError && operator ?
          <CatalogPanel catalog={catalog} token={token} reload={reload} /> :
          (tab === "orders" || tab === "kitchen" || tab === "delivery" || tab === "lookup") && branchId
            && branches.length > 0 ?
            <OrderQueuePanel key={branchId + ":" + tab} token={token} branchId={branchId}
              role={branchRole} mode={tab === "lookup" ? "orders" : tab} active
              group={tab === "lookup" ? "history" : orderGroup}
              lookupMode={tab === "lookup"}
              onGroupChange={next => {
                if (next !== "history") lastWorkingLane.current = next;
                setOrderGroup(next);
              }}
              onCloseHistory={() => tab === "lookup"
                ? setTab("settings") : setOrderGroup(lastWorkingLane.current)}
              historyStatus={tab === "lookup" ? "ALL" : historyStatus}
              historyRange={tab === "lookup" ? lookupRange : historyRange}
              onHistoryRangeChange={next => {
                if (tab === "lookup") setLookupRange(next);
                else { setReportMetric(null); setHistoryRange(next); }
              }}
              historyCode={tab === "lookup" ? lookupCode : historyCode}
              onHistoryCodeChange={value => {
                if (tab === "lookup") setLookupCode(value);
                else { setReportMetric(null); setHistoryCode(value); }
              }}
              reportMetric={tab === "lookup" ? null : reportMetric}
              onClearReportMetric={() => setReportMetric(null)}
              onHistoryStatusChange={next => {
                setReportMetric(null); setHistoryStatus(next);
              }} /> :
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
          </View> : tab === "account" ? <View style={styles.account}>
              <Text style={styles.sectionTitle}>Tài khoản quản trị</Text>
              <Text style={styles.rowTitle}>{roleName(branchRole)}</Text>
              <Text style={styles.caption}>Mỗi nhân viên chỉ xem được thông tin theo quyền của mình.</Text>
              <Action label="Đăng xuất" dangerous onPress={() => void signOut()} />
            </View> : loading && !catalog ? <View style={styles.center}>
            <ActivityIndicator color={c.red} />
            <Text style={styles.caption}>Đang tải dữ liệu chi nhánh...</Text>
          </View> : loadError || !catalog ? <View style={styles.center}>
            <Notice text={loadError || "Không tìm thấy dữ liệu chi nhánh."} error />
            <Action label="Tải lại" onPress={() => void reload().catch(() => undefined)} />
          </View> : (
            <>
              {tab === "overview" && <Overview catalog={catalog} token={token}
                branchId={branchId!} onChangeTab={next => {
                  if (next === "orders") { setReportMetric(null); lastWorkingLane.current = "new"; setOrderGroup("new"); }
                  setTab(next);
                }}
                onOpenReport={() => { setReportBack("overview"); setTab("report"); }}
                onOpenKpi={kind => {
                  const today = historyPeriodRange("today");
                  if (kind === "NEW") {
                    setReportMetric(null); lastWorkingLane.current = "new";
                    setOrderGroup("new"); setTab("orders");
                  } else if (kind === "REVENUE") {
                    setReportRange(today); setReportBack("overview"); setTab("report");
                  } else {
                    setHistoryCode(""); setHistoryStatus("ALL"); setHistoryRange(today);
                    setReportMetric(kind === "CANCELED" ? "CANCELED" : "DELIVERED");
                    setOrderGroup("history"); setTab("orders");
                  }
                }} />
              {tab === "report" && operator && branchId && <BusinessReportPanel
                token={token} branchId={branchId} range={reportRange}
                onRangeChange={setReportRange} onClose={() => setTab(reportBack)}
                onDrillDown={(metric, range) => {
                  setReportMetric(metric);
                  setHistoryCode("");
                  setHistoryStatus("ALL");
                  setHistoryRange(range);
                  setOrderGroup("history");
                  setTab("orders");
                }} />}
              {tab === "settings" && selectedBranch && <SettingsHub
                token={token} branch={selectedBranch} catalog={catalog}
                owner={principal?.role === "OWNER"} reload={reload}
                onBranchSaved={branchSaved} chimeEnabled={chimeEnabled}
                chimePending={chimePending} chimeError={chimeError}
                onChimeChange={changeChime}
                onOpenBusiness={destination => {
                  if (destination === "report") {
                    setReportBack("settings"); setTab("report");
                  } else {
                    setLookupRange(historyPeriodRange("week")); setLookupCode("");
                    setTab("lookup");
                  }
                }} />
            </>
          )}
          </ScrollView>}
        <View style={styles.bottomTabs}>
          {visibleTabs.map(item => <Pressable key={item.id}
            accessibilityRole="tab" accessibilityLabel={item.label}
            accessibilityState={{ selected: tab === item.id }}
            style={[styles.tab, tab === item.id && styles.tabSelected]}
            onPress={() => { setChooseBranch(false); setTab(item.id); }}>
            <Icon name={item.icon} size={22} color={tab === item.id ? "#FFD58A" : "#FAF1E6"} />
            <Text style={[styles.tabLabel, tab === item.id && styles.tabActive]}>{item.shortLabel}</Text>
          </Pressable>)}
        </View>
        {chooseBranch && branches.length > 0 && <View
          style={[styles.branchOverlay, { top: headerHeight }]} pointerEvents="box-none">
          <Pressable accessibilityRole="button" accessibilityLabel="Đóng danh sách chi nhánh"
            style={StyleSheet.absoluteFillObject} onPress={() => setChooseBranch(false)} />
          <View style={styles.branchMenu}>
            <ScrollView keyboardShouldPersistTaps="always"
              style={styles.branchMenuScroll} nestedScrollEnabled>
              {branches.map(branch => <Pressable key={branch.id} accessibilityRole="button"
                accessibilityLabel={"Chọn chi nhánh " + branch.name}
                style={styles.branchItem} onPress={() => {
                  setBranchId(branch.id); setChooseBranch(false);
                  setTab(branch.staffRole === "KITCHEN" ? "kitchen"
                    : branch.staffRole === "DRIVER" ? "delivery" : "overview");
                  lastWorkingLane.current = "new";
                  setOrderGroup("new");
                }}>
                <Text style={styles.branchItemText} numberOfLines={2}>{branch.name}</Text>
                {branch.id === branchId && <Text style={styles.selectedMark}>✓</Text>}
              </Pressable>)}
            </ScrollView>
          </View>
        </View>}
      </View>}
      <AdminPwaReleaseNotice />
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
  confirmOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.42)",
    justifyContent: "center", paddingHorizontal: 20 },
  confirmSheet: { backgroundColor: c.white, padding: 20, borderRadius: 14,
    gap: 14, width: "100%", maxWidth: 430, alignSelf: "center" },
  loginPage: { flex: 1, alignItems: "center", justifyContent: "center",
    paddingHorizontal: 20, backgroundColor: c.white },
  loginPanel: { width: "100%", maxWidth: 410, gap: 14 },
  loginBrand: { flexDirection: "row", alignItems: "center", gap: 10,
    paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: c.line },
  loginLogo: { width: 40, height: 40, alignItems: "center",
    justifyContent: "center" },
  loginLogoText: { color: c.white, fontSize: 20, fontWeight: "800" },
  loginBrandText: { flex: 1 },
  brandName: { color: c.red, fontSize: font.section, fontWeight: "900", letterSpacing: 0.3 },
  brandSub: { color: c.secondary, fontSize: font.caption, marginTop: 3 },
  loginTitle: { color: c.ink, fontSize: font.title, fontWeight: "800" },
  header: { backgroundColor: "#650D11", borderBottomLeftRadius: 17,
    borderBottomRightRadius: 17, overflow: "hidden" },
  headerTop: { flexDirection: "row", alignItems: "center",
    gap: 7, paddingHorizontal: 12, paddingTop: 7, paddingBottom: 6,
    minHeight: adminDensity.headerTop },
  headerText: { flex: 1, minWidth: 0 },
  branchSelector: { flex: 1.22, minWidth: 0, minHeight: adminDensity.branchSelector,
    flexDirection: "row", alignItems: "center", paddingHorizontal: 10,
    borderRadius: 11, borderWidth: 1, borderColor: "#A84B49",
    backgroundColor: "#7C201E", gap: 6 },
  branchText: { flexShrink: 1, fontSize: 12, color: c.white, fontWeight: "800", marginTop: 1 },
  branchArrow: { fontSize: 21, color: c.white },
  branchOverlay: { position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 50,
    elevation: 18, alignItems: "flex-start" },
  branchMenu: { marginTop: 4, marginLeft: 12, width: "76%", minWidth: 232, maxWidth: 360,
    borderWidth: 1, borderColor: "#A84B49", backgroundColor: "#72181B",
    borderRadius: 12, shadowColor: "#1C0808", shadowOpacity: 0.25, shadowRadius: 9,
    elevation: 18, overflow: "hidden" },
  branchMenuScroll: { maxHeight: 260 },
  branchItem: { minHeight: 44, flexDirection: "row", justifyContent: "space-between",
    alignItems: "center", paddingHorizontal: 12, gap: 8,
    borderBottomWidth: 1, borderBottomColor: "#A84B49" },
  branchItemText: { fontSize: font.body, color: c.white },
  selectedMark: { color: "#FFD58A", fontSize: font.body, fontWeight: "800" },
  scroll: { flex: 1, minHeight: 0 },
  scrollContent: { paddingBottom: 22, flexGrow: 1 },
  pagePadding: { padding: 12 },
  bottomTabs: { flexDirection: "row", borderTopWidth: 1,
    borderTopColor: "#8D3434", backgroundColor: "#420707", paddingBottom: 3,
    paddingTop: 3, paddingHorizontal: 5 },
  tab: { flex: 1, minWidth: 0, minHeight: adminDensity.bottomTab, alignItems: "center",
    justifyContent: "center", borderRadius: 10, gap: 1 },
  tabSelected: { backgroundColor: "#6E351B" },
  tabLabel: { color: "#FAF1E6", fontSize: 10, fontWeight: "700" },
  tabActive: { color: "#FFD58A" },
  overview: { paddingHorizontal: 10, paddingTop: 6, paddingBottom: 14, gap: 7 },
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
  brandHeading: { color: "#FFF8EE", fontSize: 17, lineHeight: 21, fontWeight: "800" },
  brandTagline: { color: "#F5CFC6", fontSize: 10, lineHeight: 13, marginTop: 1 },
  headerLogo: { width: adminDensity.headerLogo, height: adminDensity.headerLogo },
  heroAction: { height: 44, width: 44, alignItems: "center", justifyContent: "center" },
  headerBottom: { flexDirection: "row", paddingHorizontal: 10,
    paddingBottom: 7, gap: 7, alignItems: "stretch" },
  branchCopy: { flex: 1, minWidth: 0 },
  branchHint: { color: "#F7C9BD", fontSize: 10 },
  headerToastLayer: { position: "absolute", zIndex: 90, elevation: 90,
    left: 12, right: 12, backgroundColor: c.white, borderRadius: 8 },
  operationPill: { flex: 1, minHeight: adminDensity.branchSelector, paddingHorizontal: 8, gap: 5,
    flexDirection: "row", borderRadius: 11, backgroundColor: "#FFF2DD",
    alignItems: "center" },
  operationCopy: { flex: 1, minWidth: 0 },
  operationText: { fontSize: 11, fontWeight: "800", color: "#512C1B" },
  operationSub: { color: "#986E49", fontSize: 9, marginTop: 1 },
  operationDot: { width: 8, height: 8, borderRadius: 4 },
  dashboardDateRow: { flexDirection: "row", justifyContent: "space-between",
    gap: 5, alignItems: "center", paddingVertical: 0 },
  dashboardDate: { flex: 1, fontSize: 12, color: c.ink, fontWeight: "600" },
  dashboardRefresh: { minHeight: 44, justifyContent: "center", paddingLeft: 6 },
  refreshText: { color: c.secondary, fontSize: 10 },
  reportLink: { minHeight: 50, flexDirection: "row", alignItems: "center",
    gap: 10, marginVertical: 4, borderBottomWidth: 1, borderBottomColor: c.line },
  reportLinkText: { flex: 1, color: c.redDeep, fontSize: 14, fontWeight: "800" },
  reportLinkArrow: { fontSize: 23, color: c.redDeep },
  dashboardGrid: { flexDirection: "row", flexWrap: "wrap",
    justifyContent: "space-between", rowGap: 6, columnGap: 8 },
  dashboardMetric: { width: "48.5%", minHeight: adminDensity.dashboardMetric, borderRadius: 11,
    flexDirection: "row", alignItems: "center", padding: 6, gap: 5 },
  metricIcon: { width: adminDensity.dashboardIcon, height: adminDensity.dashboardIcon,
    borderRadius: 10, backgroundColor: "rgba(255,255,255,0.5)",
    alignItems: "center", justifyContent: "center" },
  metricCopy: { flex: 1, gap: 2, minWidth: 0 },
  metricLabel: { fontSize: 11, lineHeight: 14, color: "#3D3333" },
  metricValue: { fontSize: 16, lineHeight: 20, fontWeight: "900" },
  metricArrow: { fontSize: 17, fontWeight: "600" },
  dashboardSectionHead: { marginTop: 2, minHeight: 33,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  dashboardSectionTitle: { color: c.ink, fontSize: 15, fontWeight: "900",
    borderLeftColor: c.red, borderLeftWidth: 4, paddingLeft: 10, flexShrink: 1 },
  dashboardLink: { color: c.secondary, fontSize: 11 },
  dashboardEmpty: { padding: 16, borderRadius: 12, backgroundColor: "#FFFDFB",
    borderWidth: 1, borderColor: "#F1E6E0", alignItems: "center", gap: 6 },
  emptyTitle: { color: c.ink, fontSize: 14, fontWeight: "800" },
  dashboardOrder: { padding: 10, borderWidth: 1, borderColor: "#EFE5DD",
    backgroundColor: c.white, borderRadius: 12, gap: 8,
    shadowColor: "#462320", shadowOpacity: 0.08, shadowRadius: 8, elevation: 2 },
  dashboardOrderTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  dashboardOrderId: { fontSize: 17, fontWeight: "900", color: "#241A1A" },
  newPill: { backgroundColor: "#FFE4E7", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 5 },
  newPillText: { color: c.red, fontSize: 11, fontWeight: "800" },
  orderDate: { flex: 1, textAlign: "right", color: c.secondary, fontSize: 11 },
  dashboardOrderItems: { flexDirection: "row", alignItems: "center", gap: 11 },
  productMark: { height: 43, width: 43, borderRadius: 10,
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
