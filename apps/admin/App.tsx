import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, AppState, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StatusBar, StyleSheet, Text, View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import {
  AdminApiError, forgetSession, refreshSession, rememberSession, request,
  type AdminCatalog, type AuthTokens, type Branch, type Principal,
} from "./src/api";
import { CatalogPanel } from "./src/CatalogPanel";
import { HoursPanel } from "./src/HoursPanel";
import { Action, Field, Notice } from "./src/ui";
import { c, font } from "./src/theme";

type Tab = "overview" | "catalog" | "hours" | "account";
const tabs: { id: Tab; label: string; icon: string }[] = [
  { id: "overview", label: "Tổng quan", icon: "▦" },
  { id: "catalog", label: "Thực đơn", icon: "▤" },
  { id: "hours", label: "Giờ bán", icon: "◷" },
  { id: "account", label: "Tài khoản", icon: "♙" },
];
function roleName(role: string): string {
  return role === "OWNER" ? "Chủ cửa hàng" : "Quản lý chi nhánh";
}
function Overview({ catalog, onChangeTab }: { catalog: AdminCatalog; onChangeTab: (tab: Tab) => void }) {
  const products = catalog.categories.flatMap(x => x.products);
  const stock = products.filter(x => !x.isAvailable);
  return <View style={styles.overview}>
    <Text style={styles.sectionTitle}>Tổng quan cửa hàng</Text>
    <Text style={styles.caption}>Thống kê trực tiếp từ thực đơn chi nhánh.</Text>
    <View style={styles.stats}>
      {[
        ["Danh mục", catalog.categories.length],
        ["Sản phẩm", products.length],
        ["Tạm hết", stock.length],
      ].map(([label, value]) =>
        <View key={String(label)} style={styles.stat} accessibilityLabel={String(label) + ": " + value}>
          <Text style={styles.statNumber}>{value}</Text>
          <Text style={styles.statLabel}>{label}</Text>
        </View>)}
    </View>
    <View style={styles.overviewList}>
      <Text style={styles.sectionTitle}>Điều hành</Text>
      <Pressable style={styles.overviewRow} accessibilityRole="button"
        accessibilityLabel="Quản lý thực đơn" onPress={() => onChangeTab("catalog")}>
        <View style={styles.overviewCopy}>
          <Text style={styles.rowTitle}>Thực đơn & tồn kho</Text>
          <Text style={styles.caption}>Giá bán, topping, size và tạm hết hàng</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>
      <Pressable style={styles.overviewRow} accessibilityRole="button"
        accessibilityLabel="Cấu hình giờ bán" onPress={() => onChangeTab("hours")}>
        <View style={styles.overviewCopy}>
          <Text style={styles.rowTitle}>Giờ hoạt động</Text>
          <Text style={styles.caption}>Lịch mở cửa theo chi nhánh</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>
    </View>
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
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [accessExpiresAt, setAccessExpiresAt] = useState(0);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [chooseBranch, setChooseBranch] = useState(false);
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

  const loadIdentity = useCallback(async (access: string) => {
    const user = await request<Principal>("/auth/me", access);
    // Branch membership can grant MANAGER even when the global role is CUSTOMER.
    // The backend enforces OWNER/MANAGER permissions for every Admin API.
    const available = await request<Branch[]>("/admin/branches", access);
    if (available.length === 0) {
      throw new AdminApiError("Tài khoản chưa được cấp quyền quản trị chi nhánh.", 403);
    }
    setPrincipal(user);
    setBranches(available);
    setBranchId(old => old && available.some(b => b.id === old)
      ? old : (available[0]?.id ?? null));
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
    if (!token || !branchId) return;
    setLoading(true); setLoadError("");
    try {
      const data = await request<AdminCatalog>(
        "/admin/branches/" + branchId + "/catalog", token);
      setCatalog(data);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Không tải được thực đơn quản trị.");
      setCatalog(null);
    } finally { setLoading(false); }
  }, [token, branchId]);

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

  const selectedBranch = branches.find(b => b.id === branchId);
  return <SafeAreaProvider>
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <StatusBar barStyle="dark-content" backgroundColor={c.white} />
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
          </> 
        </View>
      </KeyboardAvoidingView> : <View style={styles.shell}>
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <View style={styles.headerText}>
              <Text style={styles.brandName}>SICHUAN HOTPOT</Text>
              <Text style={styles.brandSub}>Admin · {principal && roleName(principal.role)}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Đổi chi nhánh"
              style={styles.branchSelector} onPress={() => setChooseBranch(v => !v)}>
              <Text style={styles.branchText} numberOfLines={1}>{selectedBranch?.name ?? "Chọn chi nhánh"}</Text>
              <Text style={styles.branchArrow}>⌄</Text>
            </Pressable>
          </View>
          {chooseBranch && <View style={styles.branchMenu}>
            {branches.map(branch => <Pressable key={branch.id} accessibilityRole="button"
              accessibilityLabel={"Chọn chi nhánh " + branch.name}
              style={styles.branchItem} onPress={() => {
                setBranchId(branch.id); setChooseBranch(false); setTab("overview");
              }}>
              <Text style={styles.branchItemText}>{branch.name}</Text>
              {branch.id === branchId && <Text style={styles.selectedMark}>✓</Text>}
            </Pressable>)}
          </View>}
        </View>
        <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {!!notice && <View style={styles.pagePadding}><Notice text={notice} /></View>}
          {branches.length === 0 ? <View style={styles.center}>
            <Notice text="Chưa được cấp quyền quản lý chi nhánh nào. Chủ cửa hàng cần cấu hình phân quyền trên máy chủ." error />
          </View> : loading && !catalog ? <View style={styles.center}>
            <ActivityIndicator color={c.red} />
            <Text style={styles.caption}>Đang tải dữ liệu chi nhánh...</Text>
          </View> : loadError || !catalog ? <View style={styles.center}>
            <Notice text={loadError || "Không tìm thấy dữ liệu chi nhánh."} error />
            <Action label="Tải lại" onPress={() => void reload()} />
          </View> : (
            <>
              {tab === "overview" && <Overview catalog={catalog} onChangeTab={setTab} />}
              {tab === "catalog" && <CatalogPanel catalog={catalog} token={token} reload={reload} />}
              {tab === "hours" && <HoursPanel catalog={catalog} token={token} reload={reload} />}
              {tab === "account" && <View style={styles.account}>
                <Text style={styles.sectionTitle}>Tài khoản quản trị</Text>
                <Text style={styles.rowTitle}>{principal && roleName(principal.role)}</Text>
                <Text style={styles.caption}>Dữ liệu được giới hạn theo vai trò và chi nhánh trên API.</Text>
                <Action label="Đăng xuất" dangerous onPress={() => void signOut()} />
              </View>}
            </>
          )}
        </ScrollView>
        <View style={styles.bottomTabs}>
          {tabs.map(item => <Pressable key={item.id}
            accessibilityRole="tab" accessibilityLabel={item.label}
            accessibilityState={{ selected: tab === item.id }}
            style={styles.tab} onPress={() => { setChooseBranch(false); setTab(item.id); }}>
            <Text style={[styles.tabIcon, tab === item.id && styles.tabActive]}>{item.icon}</Text>
            <Text style={[styles.tabLabel, tab === item.id && styles.tabActive]}>{item.label}</Text>
          </Pressable>)}
        </View>
      </View>}
    </SafeAreaView>
  </SafeAreaProvider>;
}
const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: c.white },
  shell: { flex: 1, width: "100%", maxWidth: 680, alignSelf: "center",
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
  header: { borderBottomWidth: 1, borderBottomColor: c.line, backgroundColor: c.white },
  headerTop: { flexDirection: "row", alignItems: "center",
    gap: 10, paddingHorizontal: 14, minHeight: 62 },
  headerText: { flex: 1, minWidth: 0 },
  branchSelector: { minHeight: 42, maxWidth: "56%", flexDirection: "row",
    alignItems: "center", paddingHorizontal: 10, borderRadius: 9,
    borderWidth: 1, borderColor: c.line, gap: 5 },
  branchText: { flexShrink: 1, fontSize: font.note, color: c.ink, fontWeight: "700" },
  branchArrow: { fontSize: 15, color: c.red },
  branchMenu: { borderTopWidth: 1, borderTopColor: c.line, paddingHorizontal: 14 },
  branchItem: { minHeight: 44, flexDirection: "row", justifyContent: "space-between",
    alignItems: "center", borderBottomWidth: 1, borderBottomColor: c.line },
  branchItemText: { fontSize: font.body, color: c.ink },
  selectedMark: { color: c.red, fontSize: font.body, fontWeight: "800" },
  scroll: { flex: 1, minHeight: 0 },
  scrollContent: { paddingBottom: 22, flexGrow: 1 },
  pagePadding: { padding: 12 },
  bottomTabs: { flexDirection: "row", borderTopWidth: 1,
    borderTopColor: c.line, backgroundColor: c.white, paddingBottom: 4 },
  tab: { flex: 1, minWidth: 0, minHeight: 55, alignItems: "center",
    justifyContent: "center", gap: 3 },
  tabIcon: { color: c.secondary, fontSize: 19 },
  tabLabel: { color: c.secondary, fontSize: 10, fontWeight: "700" },
  tabActive: { color: c.red },
  overview: { paddingHorizontal: 14, paddingTop: 14, gap: 9 },
  stats: { flexDirection: "row", gap: 8, marginVertical: 6 },
  stat: { flex: 1, borderRadius: 10, borderWidth: 1, borderColor: c.line,
    minHeight: 75, paddingHorizontal: 11, justifyContent: "center", gap: 5 },
  statNumber: { color: c.ink, fontSize: 17, fontWeight: "800" },
  statLabel: { color: c.secondary, fontSize: font.caption },
  overviewList: { paddingTop: 10, gap: 6 },
  overviewRow: { minHeight: 66, flexDirection: "row", alignItems: "center",
    borderBottomWidth: 1, borderBottomColor: c.line, gap: 10 },
  overviewCopy: { flex: 1, gap: 5 },
  chevron: { color: c.secondary, fontSize: 22 },
  account: { padding: 15, gap: 12 },
});
