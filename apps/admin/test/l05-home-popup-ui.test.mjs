import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=x=>readFileSync(new URL(x,import.meta.url),"utf8");

test("L05 Admin exposes independent Home popup settings",()=>{
  const hub=read("../src/SettingsHub.tsx");
  const panel=read("../src/HomePopupPanel.tsx");
  assert.match(hub,/id: "popup", label: "Popup trang chủ", icon: "popup"/);
  assert.match(hub,/selected === "popup" && <HomePopupPanel/);
  assert.match(panel,/Bật popup trang chủ/);
  assert.match(panel,/Popup hiện lại sau/);
  assert.match(panel,/Mỗi ảnh hiển thị bao lâu/);
  assert.match(panel,/Chọn nhiều ảnh R2/);
  assert.match(panel,/input\.multiple=true/);
  assert.match(panel,/allowsMultipleSelection:true/);
  assert.match(panel,/\/slides\/order/);
});

test("L05 Home popup uses signed R2 tickets and safe publication gate",()=>{
  const panel=read("../src/HomePopupPanel.tsx");
  assert.match(panel,/prepareProductImage\(file\)/);
  assert.match(panel,/FileSystem\.uploadAsync/);
  assert.match(panel,/\/ticket/);
  assert.match(panel,/\/attach/);
  assert.match(panel,/2097152/);
  assert.match(panel,/Thêm ảnh R2 trước khi bật slide popup/);
});
