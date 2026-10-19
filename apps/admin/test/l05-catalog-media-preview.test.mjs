import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const catalog = read("../src/CatalogPanel.tsx");
const shared = read("../src/SharedModifierLibraryPanel.tsx");
const combo = read("../src/ComboEditorModal.tsx");
const orders = read("../src/OrderQueuePanel.tsx");
const api = read("../../api/src/admin-catalog/r2-product-images.service.ts");
const media = read("../../api/src/admin-catalog/r2-catalog-media.service.ts");

test("L05 modal stages, optimizes and previews product images BEFORE upload", () => {
  assert.match(catalog, /type PhotoDraft =/);
  assert.match(catalog, /prepareProductImage\(file\)/);
  assert.match(catalog, /URL\.createObjectURL\(prepared\.blob\)/);
  assert.match(catalog, /URL\.revokeObjectURL\(previewRef\.current\)/);
  assert.match(catalog, /setPhotoDraft\(/);
  assert.match(catalog, /Ảnh khi lưu/);
  assert.match(catalog, /Chưa tải lên R2/);
  assert.match(catalog, /selectProductPhoto\(\)/);
  assert.match(catalog, /Bỏ ảnh vừa chọn/);
  assert.match(catalog, /onPress=\{closeEditor\}/);
});

test("L05 product create is not duplicated after R2 upload errors", () => {
  const save = catalog.slice(catalog.indexOf("async function saveProductWithPhoto("),
    catalog.indexOf("function change<K extends keyof Values>"));
  assert.match(save, /const saved = await request<\{id:string\}>\(root \+ path, token, method, data\)/);
  assert.match(save, /savedId = saved\.id \|\| savedId/);
  assert.match(save, /setEditor\(prev => prev \? \{ \.\.\.prev, id: savedId \}/);
  assert.match(save, /if \(photoDraft\) await attachDraftImage\(savedId, photoDraft\)/);
  assert.match(save, /try \{ await reload\(\); \} catch/);
  assert.match(save, /không tạo trùng/);
  assert.match(catalog, /kind === "product"\) void saveProductWithPhoto/);
  assert.match(catalog, /"\/ticket"/);
  assert.match(catalog, /"\/attach"/);
  assert.match(catalog, /FileSystem\.uploadAsync/);
});

test("L05 no destructive R2 unlink without explicit inline confirmation", () => {
  assert.match(catalog, /photoRemoval\?\.kind === "products"/);
  assert.match(catalog, /Xác nhận gỡ/);
  assert.match(catalog, /Gỡ ảnh đang lưu/);
  assert.match(catalog, /Gỡ ảnh khỏi/);
  assert.match(catalog, /photoRemoval\?\.kind === mediaKind/);
  assert.match(shared, /confirmPhotoRemoval|removeImage/);
  assert.match(shared, /Xác nhận gỡ/);
  assert.match(shared, /usedBy/);
  assert.match(combo, /confirmRemoveImage/);
  assert.match(combo, /Xác nhận gỡ/);
  assert.match(api, /if \(references > 0\) continue/);
  assert.match(media, /DISABLE_GROUP_BEFORE_IMAGE_REMOVAL/);
  assert.match(media, /DISABLE_TOPPING_BEFORE_IMAGE_REMOVAL/);
});

test("L05 real media visible in product preview and order edit selection", () => {
  assert.match(catalog, /Ảnh khách nhìn thấy trong thực đơn/);
  assert.match(catalog, /st\.detailPhoto/);
  assert.match(catalog, /st\.photoCompare/);
  assert.match(catalog, /Ảnh đang lưu/);
  assert.match(catalog, /st\.catalogPhoto/);
  assert.match(orders, /imageUrl\(product\.imageKey\)/);
  assert.match(orders, /editProductPhoto/);
  assert.match(combo, /item\?\.imageKey \?\? topping\?\.option\.imageKey/);
});

test("L05 existing catalog overlay is keyboard-aware and scroll-safe", () => {
  assert.match(catalog, /<KeyboardAvoidingView style=\{st\.backdrop\}/);
  assert.match(catalog, /behavior=\{Platform\.OS === "ios" \? "padding" : undefined\}/);
  assert.match(catalog, /keyboardShouldPersistTaps="handled"/);
  assert.match(catalog, /maxHeight: "93%"/);
  assert.match(catalog, /modalBody: \{ padding: 12, gap: 9, paddingBottom: 22 \}/);
});
