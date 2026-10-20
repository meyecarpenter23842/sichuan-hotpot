import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const hub = read("../src/SettingsHub.tsx");
const delivery = read("../src/DeliveryPolicyPanel.tsx");
const hero = read("../src/HomeHeroPanel.tsx");
const catalog = read("../src/CatalogPanel.tsx");
test("admin notification diagnostics are optional while existing sound switch stays available", () => {
  assert.match(hub, /StatusSwitch value={chimeEnabled} busy={chimePending}/);
  assert.match(hub, /label={showDiagnostics \? "Ẩn phần kiểm tra" : "Kiểm tra thông báo và âm thanh"}/);
  assert.match(hub, /{showDiagnostics && <NotificationTester token={token} branchId={branch\.id} \/>}/);
  assert.match(hub, /setShowDiagnostics\(false\)/);
  assert.doesNotMatch(hub, /Km, phụ phí|WebSocket vẫn đồng bộ danh sách đơn/);
});
test("delivery labels reflect zone pricing but preserved payload and safety rules", () => {
  assert.match(hub, /label: "Phí giao"/);
  assert.match(delivery, /pricingMode: "ZONE"/);
  assert.match(delivery, /!zones\.length \|\| !zones\.some\(zone => zone\.isActive\)/);
  assert.match(delivery, /Đã thiết lập {current\.zones\.length} vùng giao/);
  assert.doesNotMatch(delivery, /Không dùng định tuyến OSRM/);
});
test("image screens keep upload controls without naming storage infrastructure", () => {
  assert.match(hero, /\/slides\/order/);
  assert.match(hero, /Chọn hoặc thay ảnh/);
  assert.match(catalog, /pickCatalogMedia\(mediaKind, editor\.id!\)/);
  assert.match(catalog, /Thay ảnh/);
  assert.doesNotMatch(catalog, /Thay ảnh R2|CORS bucket|cấu hình R2 trên VPS/);
});
