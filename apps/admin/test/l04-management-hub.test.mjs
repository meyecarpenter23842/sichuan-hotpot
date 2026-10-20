import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const app = read("../App.tsx");
const hub = read("../src/SettingsHub.tsx");
const icon = read("../src/Icon.tsx");
const panel = read("../src/OrderQueuePanel.tsx");
const service = read("../../api/src/orders/admin-orders.service.ts");

test("L04 management is a three-section 3-column icon hub, with existing settings preserved", () => {
  assert.match(hub, /<Text style=\{s.title\}>Quản lý<\/Text>/);
  for (const title of ["Kinh doanh", "Cửa hàng", "Ứng dụng & Marketing"]) {
    assert.match(hub, new RegExp('title: "' + title + '"'));
  }
  for (const id of ["report", "lookup", "branch", "hours", "delivery", "status",
    "orders", "create", "alerts", "offers", "hero", "popup", "chatbot", "customers"]) {
    assert.match(hub, new RegExp('id: "' + id + '"'));
  }
  assert.match(hub, /width: "33\.3333%"/);
  assert.match(hub, /tileWide: \{ width: "16\.6667%" \}/);
  assert.match(hub, /Math\.max\(48, adminDensity.settingIcon\)/);
  assert.match(hub, /numberOfLines=\{2\}>\{item\.label\}/);
  assert.match(hub, /section\.items\.filter\(item => owner \|\| !item\.owner\)/);
  assert.match(hub, /owner: false, destination: "report"/);
  assert.match(hub, /owner: false, destination: "lookup"/);
  assert.match(hub, /id: "delivery", label: "Phí giao", icon: "delivery", owner: true/);
  assert.match(hub, /id: "customers", label: "Khách hàng", icon: "users", owner: true/);
  assert.doesNotMatch(hub, /tileHint/);
  assert.match(icon, /case "manage":/);
  assert.match(icon, /case "report":/);
  assert.match(icon, /case "search":/);
});

test("L04 business pages are full screens; existing configuration remains a dirty-aware modal", () => {
  assert.match(hub, /onOpenBusiness\(item\.destination\)/);
  assert.match(hub, /<Modal visible=\{selected !== null\}/);
  assert.match(hub, /if \(dirty\) \{ setConfirmClose\(true\); return; \}/);
  assert.match(hub, /<Action label="Bỏ thay đổi" dangerous onPress=\{forceClose\} \/>/);
  assert.match(hub, /selected === "hours" && <HoursPanel/);
  assert.match(hub, /selected === "delivery" && <DeliveryPolicyPanel/);
  assert.match(hub, /selected === "alerts" && <View/);
  assert.match(app, /tab === "report" && operator && branchId/);
  assert.match(app, /tab === "settings" && selectedBranch && <SettingsHub/);
  assert.match(app, /lookupMode=\{tab === "lookup"\}/);
  assert.match(app, /if \(destination === "report"\)/);
  assert.match(app, /setTab\("lookup"\)/);
  assert.match(app, /const \[lookupRange, setLookupRange\] = useState<HistoryRange>\(ALL_HISTORY\)/);
  assert.doesNotMatch(app, /setLookupRange\(historyPeriodRange\("week"\)\)/);
  assert.match(app, /setReportBack\("settings"\)/);
  assert.match(app, /onClose=\{\(\) => setTab\(reportBack\)\}/);
  assert.match(panel, /lookupMode \|\| hasCode \|\| reportMetric/);
  assert.match(panel, /!lookupMode && historyStatus !== "ALL"/);
  assert.match(panel, /inHistory && !lookupMode && !historyCode\.trim\(\)/);
  assert.match(panel, /lookupMode \? "Tra cứu đơn" : "Lịch sử đơn"/);
  assert.match(panel, /lookupMode \? "Quản lý" : "Đơn hàng"/);
  assert.match(panel, /lookupMode \? "Quay lại Quản lý"/);
});

test("L04 summary metrics drill into correct event-day cohorts and restore origin", () => {
  assert.match(service, /canceledToday\] = await Promise\.all/);
  assert.match(service, /status: "CANCELED", statusHistory: \{ some:/);
  assert.match(service, /canceledCount: canceledToday/);
  assert.match(app, /canceledCount: number/);
  for (const name of ["Đơn mới", "Đã hủy hôm nay", "Đã giao hôm nay", "Giá trị giao hôm nay"]) {
    assert.ok(app.includes(name));
  }
  assert.match(app, /onPress=\{\(\) => onOpenKpi\(metric\.kind\)\}/);
  assert.match(app, /const today = historyPeriodRange\("today"\)/);
  assert.match(app, /kind === "CANCELED" \? "CANCELED" : "DELIVERED"/);
  assert.match(app, /setHistoryBack\("overview"\)/);
  assert.match(app, /setHistoryBack\("report"\)/);
  assert.match(app, /setReportRange\(today\)/);
  assert.match(app, /setTab\(historyBack\)/);
  assert.match(app, /setTab\("settings"\)/);
  assert.doesNotMatch(app, /metric\.target/);
});

test("L04 no owner-only setting is unlocked for MANAGER, no extra bottom tab", () => {
  assert.match(app, /const operator = branchRole === "OWNER" \|\| branchRole === "MANAGER"/);
  assert.match(app, /owner=\{principal\?\.role === "OWNER"\}/);
  assert.match(app, /driverOnly \? item\.id === "delivery"/);
  assert.match(app, /kitchenOnly \? item\.id === "kitchen"/);
  assert.match(app, /\["overview", "orders", "kitchen", "catalog", "delivery"\]/);
  assert.match(service, /ORDER_SUMMARY_FORBIDDEN/);
  assert.match(service, /ORDER_LOOKUP_FORBIDDEN/);
});
