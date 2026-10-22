import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
const read = file => readFileSync(new URL(file, import.meta.url), "utf8");
const api = read("../../api/src/dining/dining.service.ts");
const realtime = read("../../api/src/orders/order-realtime.service.ts");
const board = read("../src/DiningTablesPanel.tsx");
const kitchen = read("../src/DiningKitchenPanel.tsx");
const app = read("../App.tsx");
const native = read("../src/dining-alert.native.ts");
const browser = read("../src/dining-alert.ts");
test("L06: publish only after committed ticket and approval, not on replay", () => {
  assert.match(api, /if \(!result\.replayed\) await this\.publishCommitted/);
  assert.match(api, /Promise\.allSettled/);
  assert.match(api, /type: source === "QR" \? "dining\.pending" : "dining\.kitchen"/);
  assert.match(api, /type: decision === "APPROVED" \? "dining\.kitchen" : "dining\.ticket"/);
  assert.match(api, /DINING_KITCHEN_TRANSITION_INVALID/);
  assert.match(api, /DINING_TICKET_STATUS_STALE/);
  assert.match(realtime, /publishDining\(change: DiningChange\)/);
  assert.match(realtime, /sub\.role === "DINING_GUEST"/);
  assert.match(realtime, /grant\.revokedAt/);
  // L07 audited voids must notify the kitchen to remove cancelled work items.
  assert.match(realtime, /\["APPROVED", "PREPARING", "READY", "SERVED", "CANCELED"\]/);
  assert.match(realtime, /sub\.role === "KITCHEN"/);
  assert.match(realtime, /"PENDING_APPROVAL"/);
  assert.match(realtime, /"WAITER", "CASHIER"/);
  assert.doesNotMatch(realtime, /lineTotalVnd|paidVnd|phoneE164/);
});
test("L06: separate operational kitchen is isolated from delivery order queue", () => {
  assert.match(app, /<DiningKitchenPanel token={token} branchId={branchId}/);
  assert.match(app, /<OrderQueuePanel/);
  assert.match(kitchen, /"\/kitchen", token/);
  assert.match(kitchen, /"\/kitchen-status"/);
  assert.match(kitchen, /"APPROVED" \| "PREPARING" \| "READY" \| "SERVED"/);
  assert.match(kitchen, /AppState\.currentState === "active"/);
});
test("L06: bell and demo-safe QR alarm without fake ticket", () => {
  assert.match(board, /Chuông yêu cầu QR/);
  assert.match(board, /Test thông báo và âm QR/);
  assert.match(board, /playDiningAlert\(true\)/);
  assert.match(board, /seenPending\.current\.has/);
  assert.match(native, /scheduleNotificationAsync/);
  assert.match(browser, /AudioContext/);
  assert.doesNotMatch(native, /\/tickets|createOrder/);
});
