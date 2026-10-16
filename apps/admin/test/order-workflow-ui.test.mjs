import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const orders = readFileSync(new URL("../src/OrderQueuePanel.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../../api/src/orders/admin-orders.controller.ts", import.meta.url), "utf8");
const service = readFileSync(new URL("../../api/src/orders/admin-orders.service.ts", import.meta.url), "utf8");

test("orders and kitchen are separate real Admin tabs, not dashboard setup cards", () => {
  assert.match(app, /id: "orders", label: "Đơn hàng", shortLabel: "Đơn", icon: "orders"/);
  assert.match(app, /id: "kitchen", label: "Bếp", shortLabel: "Bếp", icon: "kitchen"/);
  assert.match(app, /<OrderQueuePanel key=\{branchId/);
  assert.match(app, /"\/admin\/orders\/branches"/);
  assert.match(app, /!kitchenOnly \|\| item\.id === "kitchen"/);
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
  assert.match(api, /"DELIVERING", "DELIVERED", "DELIVERY_FAILED"/);
  assert.match(api, /@Put\(":branchId\/:orderId\/items"\)/);
  assert.match(service, /findUnique\(\{\s*where: \{ branchId_userId:/);
  assert.match(service, /assertOrderTransition/);
  assert.match(service, /tx\.order\.updateMany/);
  assert.match(service, /status: input\.expectedStatus/);
  assert.match(service, /tx\.orderStatusHistory\.create/);
  assert.match(service, /TransactionIsolationLevel\.Serializable/);
  assert.match(service, /orderEditAudit\.create/);
  assert.match(service, /priceCart\(input\.items, products\)/);
  assert.match(service, /order\.payment\?\.method === "COD"/);
  assert.match(service, /staff\.role === "KITCHEN" \? \{\} :/);
});


test("Admin order sheet exposes guarded edit and complete delivery actions", () => {
  assert.match(orders, /label: "Bắt đầu giao"/);
  assert.match(orders, /label: "Đã giao thành công"/);
  assert.match(orders, /label: "Giao thất bại"/);
  assert.match(orders, /label: "Giao lại"/);
  assert.match(orders, /Sửa đơn/);
  assert.match(orders, /Lý do sửa đơn/);
  assert.match(orders, /"\/items",\s*token, "PUT"/);
  assert.match(orders, /expectedUpdatedAt: selected\.updatedAt/);
  assert.match(orders, /Giá được tính lại từ catalog trên máy chủ/);
});

test("staff order detail shows customer note and combo child size snapshot", () => {
  assert.match(orders, /Ghi chú khách hàng/);
  assert.match(orders, /selected\.customerNote/);
  assert.match(orders, /component\.variantName/);
  assert.match(service, /customerNote: true/);
  assert.match(service, /variantName: true/);
});


test("Admin order editor reconstructs and edits shared topping combo snapshots safely", () => {
  assert.match(orders, /modifierOptionId/);
  assert.match(orders, /comboChoices\(group\)/);
  assert.match(orders, /sourceType === "TOPPING"/);
  assert.match(orders, /snapshot\.modifierOptionId/);
  assert.match(orders, /Topping đang tạm hết/);
  assert.match(service, /modifierOptionId: component\.modifierOptionId/);
});
