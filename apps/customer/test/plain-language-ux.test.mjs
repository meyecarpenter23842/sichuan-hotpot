import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const app = read("../App.tsx");
const checkout = read("../src/screens/CheckoutPanel.tsx");
test("customer checkout uses understandable prices and retains safe payment flow", () => {
  assert.match(checkout, />Tiền món<\/Text>/);
  assert.match(checkout, /Phí giao có thể thay đổi/);
  assert.match(checkout, /disabled={busy \|\| \(method === "QR" && !qrAvailable\)}/);
  assert.match(checkout, /if \(lock\.current/);
  assert.match(checkout, /idempotencyKey: pending\.idempotencyKey/);
  assert.doesNotMatch(checkout, /Tạm tính từ máy chủ|không tự đánh dấu đã thanh toán|chưa được cửa hàng cấu hình/);
});
test("customer home keeps retry and no developer-only API instructions", () => {
  assert.match(app, /Không tải được thực đơn\. Kiểm tra mạng rồi thử lại\./);
  assert.match(app, /refreshCatalogue\(\)/);
  assert.doesNotMatch(app, /Chưa kết nối API thực đơn|Vui lòng kiểm tra cấu hình API/);
});
