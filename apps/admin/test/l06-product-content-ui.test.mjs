import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=x=>readFileSync(new URL(x,import.meta.url),"utf8");

test("L06 Admin product modal edits all customer-facing content with bounded multiline fields",()=>{
  const panel=read("../src/CatalogPanel.tsx");
  const api=read("../src/api.ts");
  assert.match(api,/description: string \| null; ingredients: string \| null/);
  assert.match(api,/productNotes: string \| null; allergenNotice: string \| null/);
  assert.match(panel,/label="Mô tả món" multiline maxLength=\{1200\}/);
  assert.match(panel,/label="Thành phần" multiline maxLength=\{1200\}/);
  assert.match(panel,/label="Lưu ý" multiline maxLength=\{800\}/);
  assert.match(panel,/label="Thông tin dị ứng" multiline maxLength=\{800\}/);
  assert.match(panel,/description: v\.description\.trim\(\) \|\| null/);
  assert.match(panel,/ingredients: v\.ingredients\.trim\(\) \|\| null/);
});

test("L06 Admin previews customer placement without making another card stack",()=>{
  const panel=read("../src/CatalogPanel.tsx");
  assert.match(panel,/Nội dung khách sẽ thấy/);
  assert.match(panel,/Xem trước vị trí hiển thị/);
  assert.match(panel,/Xem thành phần ›/);
  assert.match(panel,/Không dùng để cam kết an toàn dị ứng/);
  assert.doesNotMatch(panel,/dangerouslySetInnerHTML|WebView/);
});
