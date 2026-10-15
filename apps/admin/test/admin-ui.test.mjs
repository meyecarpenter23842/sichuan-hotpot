import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const catalog = readFileSync(new URL("../src/CatalogPanel.tsx", import.meta.url), "utf8");
const hours = readFileSync(new URL("../src/HoursPanel.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
const theme = readFileSync(new URL("../src/theme.ts", import.meta.url), "utf8");

test("independent Admin app uses real sign-in and branch-scoped role checks", () => {
  assert.match(app, /request<Principal>\("\/auth\/me"/);
  assert.match(app, /request<Branch\[]>\("\/admin\/branches"/);
  assert.match(app, /available\.length === 0/);
  assert.doesNotMatch(app, /user\.role !== "OWNER" && user\.role !== "MANAGER"/);
  assert.match(app, /"\/admin\/branches"/);
  assert.match(app, /request<AuthTokens>\("\/auth\/login"/);
  assert.match(app, /placeholder="Nhập mật khẩu"/);
  assert.doesNotMatch(app, /placeholder="6–8 ký tự"/);
  assert.match(app, /refreshSession/);
  assert.match(app, /forgetSession/);
  assert.match(api, /Platform\.OS === "web"/);
  assert.match(api, /SecureStore\.setItemAsync/);
  assert.doesNotMatch(api, /AsyncStorage\.setItem\(REFRESH_KEY/);
});

test("Admin cards and text are compact per the approved reference", () => {
  assert.match(theme, /caption: 11, note: 12, body: 13, action: 13, section: 14, title: 17/);
  assert.match(app, /fontSize: font\.title/);
  assert.match(app, /fontSize: font\.section/);
  assert.match(catalog, /minHeight: 58/);
  assert.doesNotMatch(catalog, /fontSize:\s*(?:2[3-9]|[3-9][0-9])/);
});

test("all catalog operations are backed by branch-scoped real API calls", () => {
  assert.match(catalog, /"\/products\/"/);
  assert.match(catalog, /"\/categories"/);
  assert.match(catalog, /"\/variants\/"/);
  assert.match(catalog, /"\/groups\/"/);
  assert.match(catalog, /"\/options\/"/);
  assert.match(catalog, /"DELETE"/);
  assert.match(catalog, /request\(root \+ path, token, method, body\)/);
  assert.match(catalog, /uploadUrl/);
  assert.match(catalog, /"\/images\/attach"/);
  assert.match(catalog, /Tạm hết/);
});

test("opening hours remain explicitly unconfigured until operator saves", () => {
  assert.match(hours, /catalog\.openingHours\.length === 0/);
  assert.match(hours, /opening-hours/);
  assert.match(hours, /method|PUT/);
  assert.match(hours, /HH:mm/);
});

test("Admin recovery requests a real backend Resend OTP and accepts OWNER longer passwords", () => {
  assert.match(app, /request\("\/auth\/password\/request-code"/);
  assert.match(app, /request\("\/auth\/password\/reset"/);
  assert.match(app, /label="Quên mật khẩu\?"/);
  assert.match(app, /label="Mã xác minh \(6 số\)"/);
  assert.match(app, /label="Mật khẩu mới"/);
  assert.match(app, /recoveryPassword\.length > 128/);
  assert.doesNotMatch(app, /Set-Cookie:.*password/i);
});

test("401 from Admin login is incorrect credentials, while session refresh remains expired", () => {
  assert.match(api, /path === "\/auth\/login"/);
  assert.match(api, /Tên đăng nhập hoặc mật khẩu không đúng/);
  assert.match(api, /response\.status === 401 \? "Phiên đăng nhập đã hết hạn\."/);
  assert.match(api, /\bwebSession\b/);
});

test("OWNER first-store onboarding uses real POST/PATCH endpoints and safe delivery policy", () => {
  const branch = readFileSync(new URL("../src/BranchPanel.tsx", import.meta.url), "utf8");
  const policy = readFileSync(new URL("../src/DeliveryPolicyPanel.tsx", import.meta.url), "utf8");
  assert.match(app, /Tạo chi nhánh đầu tiên/);
  assert.match(app, /onSaved={branchSaved}/);
  assert.match(branch, /"\/admin\/branches"/);
  assert.match(branch, /"PATCH"/);
  assert.match(branch, /Địa chỉ cửa hàng/);
  assert.match(branch, /Kích hoạt chi nhánh/);
  assert.match(policy, /"\/delivery-policy"/);
  assert.match(policy, /acceptingOrders/);
  assert.match(policy, /Lưu chính sách phí vùng/);
  assert.match(policy, /Nhận đơn trực tuyến/);
  assert.match(policy, /wardCodes/);
  assert.match(policy, /catalogVersion/);
  assert.match(policy, /pricingMode: "ZONE"/);
});

test("branch setup locates only after tapping GPS and keeps manually editable coordinates", () => {
  const branch = readFileSync(new URL("../src/BranchPanel.tsx", import.meta.url), "utf8");
  const pkg = readFileSync(new URL("../package.json", import.meta.url), "utf8");
  assert.match(branch, /Location.requestForegroundPermissionsAsync/);
  assert.match(branch, /Location.getCurrentPositionAsync/);
  assert.match(branch, /latitude.toFixed\(7\)/);
  assert.match(branch, /longitude.toFixed\(7\)/);
  assert.match(branch, /Lấy định vị GPS hiện tại/);
  assert.match(branch, /disabled=\{saving \|\| locating\}/);
  assert.match(pkg, /"expo-location": "~19.0.8"/);
});

test("hours are chosen from a mobile picker rather than manually typed", () => {
  assert.match(hours, /accessibilityLabel=\{"Giờ mở " \+ weekdays\[day\.weekday\]\}/);
  assert.match(hours, /accessibilityLabel=\{"Giờ đóng " \+ weekdays\[day\.weekday\]\}/);
  assert.match(hours, /accessibilityLabel=\{"Chọn giờ " \+ hour\}/);
  assert.match(hours, /accessibilityLabel=\{"Chọn phút " \+ minute\}/);
  assert.match(hours, /"Áp dụng giờ"/);
  assert.match(hours, /picker\?\.weekday === day\.weekday/);
  assert.doesNotMatch(hours, /<Modal transparent visible=\{!!picker\}/);
  assert.doesNotMatch(hours, /<TextInput/);
});
test("freshly opened weekdays do not retain invalid midnight-only ranges", () => {
  assert.match(hours, /const needsHours = !hhmm\.test\(day\.opensAt\)/);
  assert.match(hours, /isClosed: false, opensAt: "08:00", closesAt: "21:00"/);
  assert.match(hours, /if \(day\.isClosed\) return null;/);
  assert.match(hours, /days\.find\(x => validDay\(x\) !== null\)/);
  assert.match(hours, /weekdays\[invalid\.weekday\] \+ ": " \+ validDay\(invalid\)/);
  assert.match(hours, /setError\(""\); setNotice\(""\)/);
  assert.match(hours, /"PUT", \{ days \}/);
});

test("Settings is reached through the hero icon and remains a dedicated screen, not Overview", () => {
  const hub = readFileSync(new URL("../src/SettingsHub.tsx", import.meta.url), "utf8");
  const icons = readFileSync(new URL("../src/Icon.tsx", import.meta.url), "utf8");
  assert.match(app, /id: "settings", label: "Thiết lập", shortLabel: "Thiết lập", icon: "settings"/);
  assert.match(app, /tab === "settings" && selectedBranch && <SettingsHub/);
  assert.match(app, /accessibilityLabel="Mở thiết lập"/);
  assert.doesNotMatch(app, /onChangeTab\("settings"\)/);
  assert.match(hub, /style=\{s\.grid\}/);
  assert.match(hub, /<Modal visible=\{selected !== null\}/);
  assert.match(hub, /confirmClose/);
  assert.match(hub, /onDirtyChange=\{setDirty\}/);
  assert.match(icons, /Consistent line icons drawn with React Native primitives/);
});

test("Catalog keeps product list flat and moves sizes, toppings and images into a detail modal", () => {
  assert.match(catalog, /\{expanded && <Modal visible animationType="slide" transparent/);
  assert.match(catalog, /<Icon name="edit" size=\{19\}/);
  assert.match(catalog, /setExpandedId\(null\)/);
  assert.doesNotMatch(catalog, /\{expanded && <View style=\{st\.details\}>/);
});
