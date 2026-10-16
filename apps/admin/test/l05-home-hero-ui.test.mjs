import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=x=>readFileSync(new URL(x,import.meta.url),"utf8");

test("L05 Admin exposes a dedicated Banner trang chủ popup",()=>{
  const hub=read("../src/SettingsHub.tsx");
  const panel=read("../src/HomeHeroPanel.tsx");
  assert.match(hub,/id: "hero", label: "Banner trang chủ", icon: "banner"/);
  assert.match(hub,/selected === "hero" && <HomeHeroPanel/);
  assert.match(panel,/\/hero"/);
  assert.match(panel,/transitionType:transition/);
  assert.match(panel,/\["fade","Mờ dần"\]/);
  assert.match(panel,/\["slide","Trượt"\]/);
  assert.match(panel,/\["wipe","Gạt ngang"\]/);
  assert.match(panel,/Xem thử chuyển động/);
  assert.match(panel,/\/slides\/order/);
  assert.match(panel,/StatusSwitch label=\{"Hiển thị "/);
});

test("L05 Admin hero images use signed R2 workflow and no device-only persistence",()=>{
  const panel=read("../src/HomeHeroPanel.tsx");
  assert.match(panel,/prepareProductImage\(file\)/);
  assert.match(panel,/FileSystem\.uploadAsync/);
  assert.match(panel,/\/ticket/);
  assert.match(panel,/\/attach/);
  assert.match(panel,/2097152/);
  assert.doesNotMatch(panel,/AsyncStorage/);
});
