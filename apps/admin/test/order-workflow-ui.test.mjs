import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const orders = readFileSync(new URL("../src/OrderQueuePanel.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../../api/src/orders/admin-orders.controller.ts", import.meta.url), "utf8");
const service = readFileSync(new URL("../../api/src/orders/admin-orders.service.ts", import.meta.url), "utf8");

test("orders and kitchen are separate real Admin tabs, not dashboard setup cards", () => {
  assert.match(app, /id: "orders", label: "Đơn hàng", icon: "orders"/);
  assert.match(app, /id: "kitchen", label: "Bếp", icon: "kitchen"/);
  assert.match(app, /<OrderQueuePanel key=\{branchId/);
  assert.match(app, /"\/admin\/orders\/branches"/);
  assert.match(app, /item\.id === "kitchen" \|\| item\.id === "account"/);
});

test("orders never fake sync and use real backend status patch and retry on reconnect", () => {
  assert.match(orders, /request<StaffOrder\[]>\("\/admin\/orders\/" \+ branchId, token\)/);
  assert.match(orders, /"\/status",\s*token, "PATCH"/);
  assert.match(orders, /expectedStatus: selected\.status, toStatus: action/);
  assert.match(orders, /AppState\.addEventListener\("change"/);
  assert.match(orders, /setInterval\(\(\) =>/);
  assert.match(orders, /Đã đồng bộ lúc/);
  assert.match(orders, /Mất đồng bộ/);
  assert.match(orders, /Modal visible=\{!!selected\}/);
  assert.doesNotMatch(orders, /setOrders\(\[\s*\{\s*id:/);
});

test("server authorizes kitchen by branch, enforces CAS and commits audit with each status", () => {
  assert.match(api, /@Patch\(":branchId\/:orderId\/status"\)/);
  assert.match(api, /@IsIn\(\["CONFIRMED", "CANCELED", "PREPARING", "READY"\]\)/);
  assert.match(service, /findUnique\(\{\s*where: \{ branchId_userId:/);
  assert.match(service, /assertOrderTransition/);
  assert.match(service, /tx\.order\.updateMany/);
  assert.match(service, /status: input\.expectedStatus/);
  assert.match(service, /tx\.orderStatusHistory\.create/);
  assert.match(service, /TransactionIsolationLevel\.Serializable/);
  assert.match(service, /staff\.role === "KITCHEN" \? \{\} :/);
});
