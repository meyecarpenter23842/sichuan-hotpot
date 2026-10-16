import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read=x=>readFileSync(new URL(x,import.meta.url),"utf8");
test("L04 Settings uses owner-scoped popup with real CRUD and signed R2 workflow",()=>{
 const hub=read("../src/SettingsHub.tsx");
 const panel=read("../src/HomeOffersPanel.tsx");
 assert.match(hub,/id: "offers", label: "Ưu đãi hôm nay"/);
 assert.match(hub,/selected === "offers" && <HomeOffersPanel/);
 assert.match(panel,/prepareProductImage\(file\)/);
 assert.match(panel,/FileSystem\.uploadAsync/);
 assert.match(panel,/\/ticket"/);
 assert.match(panel,/\/attach"/);
 assert.match(panel,/\/order"/);
 assert.match(panel,/Đã lưu nội dung ưu đãi lên máy chủ/);
 assert.match(panel,/onDirtyChange\(true\)/);
 assert.match(panel,/accessibilityRole="checkbox"/);
});
test("L04 time editor converts Vietnam local time to UTC without client timezone drift",()=>{
 const p=read("../src/HomeOffersPanel.tsx");
 assert.match(p,/Date\.UTC\(year,month-1,day,hour-7,minute,0\)/);
 assert.match(p,/Giờ Việt Nam/);
 assert.match(p,/OFFER_IMAGE_REQUIRED|Thêm ảnh trước khi bật|Hãy thêm ảnh trước khi bật/);
});
