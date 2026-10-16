import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const catalog = readFileSync(new URL("../src/CatalogPanel.tsx", import.meta.url), "utf8");
const editor = readFileSync(new URL("../src/ComboEditorModal.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../../api/src/admin-catalog/admin-catalog.controller.ts", import.meta.url), "utf8");
const service = readFileSync(new URL("../../api/src/admin-catalog/admin-catalog.service.ts", import.meta.url), "utf8");
const schema = readFileSync(new URL("../../api/prisma/schema.prisma", import.meta.url), "utf8");

test("Admin creates a real COMBO product and configures its composition in a dedicated editor", () => {
  assert.match(catalog, /productKind: "STANDARD" \| "COMBO"/);
  assert.match(catalog, /label="Combo"/);
  assert.match(catalog, /<ComboEditorModal/);
  assert.match(catalog, /Thiết lập combo/);
  assert.match(editor, /Thành phần cố định/);
  assert.match(editor, /Nhóm khách lựa chọn/);
  assert.match(editor, /Lưu cấu hình combo/);
  assert.match(editor, /"\/products\/" \+ product\.id \+ "\/combo"/);
});

test("combo backend has explicit schema and rejects nested/cross-branch composition", () => {
  assert.match(schema, /enum ProductKind[\s\S]*STANDARD[\s\S]*COMBO/);
  assert.match(schema, /model ProductComboFixedItem/);
  assert.match(schema, /model ProductComboGroup/);
  assert.match(schema, /model ProductComboOption/);
  assert.match(schema, /model OrderItemComboSnapshot/);
  assert.match(api, /@Put\("products\/:productId\/combo"\)/);
  assert.match(service, /COMBO_CHILD_MUST_BE_STANDARD_SAME_BRANCH/);
  assert.match(service, /PRODUCT_USED_BY_COMBO_CANNOT_NEST/);
  assert.match(service, /TransactionIsolationLevel\.Serializable/);
});
