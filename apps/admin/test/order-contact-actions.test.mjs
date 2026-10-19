import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const panel = read("../src/OrderQueuePanel.tsx");
const service = read("../../api/src/orders/admin-orders.service.ts");

test("order detail shows customer call + map navigation only when authorized", () => {
  assert.match(panel, /!kitchenOnly && <>/);
  assert.match(panel, /orderCustomerCallUrl\(selected.phoneSnapshot\)/);
  assert.match(panel, /orderCustomerDirectionsUrl\(selected.latitudeSnapshot, selected.longitudeSnapshot\)/);
  assert.match(panel, /accessibilityLabel="Gọi điện cho khách hàng"/);
  assert.match(panel, /accessibilityLabel="Xem định vị khách hàng và chỉ đường trên bản đồ"/);
  assert.match(panel, /Linking.openURL\(url\)/);
  assert.match(panel, /Không mở được ứng dụng gọi điện hoặc bản đồ/);
  assert.match(panel, /chưa có ghim GPS hợp lệ/);
  assert.match(service, /staff.role === "KITCHEN" \? \{\} : \{[\s\S]*?latitudeSnapshot: true, longitudeSnapshot: true/);
});
