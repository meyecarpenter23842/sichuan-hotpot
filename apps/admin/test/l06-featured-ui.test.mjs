import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = path => readFileSync(new URL(path,import.meta.url),"utf8");
test("L06 featured and order modals use branch revision and server persistence",()=>{
  const src=read("../src/CatalogPanel.tsx");
  assert.match(src,/saveSelection\("featured"/);
  assert.match(src,/saveSelection\("order"/);
  assert.match(src,/catalog\.catalogRevision/);
  assert.match(src,/Đã bán \{product.soldCount\}/);
});
test("header activates branch in place with a switch and auto-dismiss error",()=>{
  const src=read("../App.tsx");
  assert.match(src,/\/activation", token, "PATCH"/);
  assert.match(src,/StatusSwitch label="Mở hoặc tắt chi nhánh"/);
  assert.match(src,/setTimeout\(\(\) => setHeaderToast/);
  assert.doesNotMatch(src,/accessibilityLabel="Thiết lập hoạt động cửa hàng"/);
});
