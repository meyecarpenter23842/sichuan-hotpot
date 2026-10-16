import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const catalog = read("../src/CatalogPanel.tsx");
const groups = read("../src/ModifierGroupsPanel.tsx");
const sw = read("../src/StatusSwitch.tsx");
const library = read("../src/SharedModifierLibraryPanel.tsx");
test("L03 provides actual branch-scoped reusable groups and accessible controls", () => {
  assert.match(catalog, /<SharedModifierLibraryPanel catalog=\{catalog\}/);
  assert.match(catalog, /tab === "modifiers"/);
  assert.match(catalog, /validateGroupAvailability/);
  assert.match(library, /catalog\.modifierLibrary/);
  assert.match(library, /group\.options\.map\(option=>/);
  assert.match(library, /usedByProductIds/);
  assert.match(library, /accessibilityRole="checkbox"/);
  assert.match(sw, /accessibilityRole="switch"/);
  assert.match(sw, /minHeight: 44, minWidth: 56/);
});
test("L03 attaches shared groups to multiple products without duplicate creation", () => {
  assert.match(library, /group-assignments/);
  assert.match(library, /revision:latest\.catalogRevision/);
  assert.match(catalog, /setAssignProductId/);
  assert.match(library, /pickMedia\("options"/);
  assert.match(library, /pickMedia\("groups"/);
  assert.match(catalog, /busyRef\.current = true/);
  assert.match(catalog, /request\(root \+ path, token, method, body\)/);
});

test("L05 displays server and selection errors in both tabs", () => {
  const toast = '{toast && <View style={st.toastLayer} pointerEvents="box-none">';
  const modal = '<Modal visible={editor !== null}';
  assert.ok(catalog.indexOf(toast) >= 0 && catalog.indexOf(toast) < catalog.indexOf(modal),
    "Errors must render above the scrolling body for either tab");
  assert.match(catalog, /setTimeout\(\(\) =>/);
  assert.match(catalog, /4200/);
  assert.match(catalog, /accessibilityLabel="Đóng thông báo"/);
  assert.match(catalog, /remaining < group\.minSelect/);
});

test("L03 avoids opening a group picker above the product-details modal",()=>{
  assert.match(catalog,/expanded && assignProductId === null && <Modal/);
  assert.match(catalog,/setExpandedId\(null\)/);
  assert.doesNotMatch(catalog,/onPress=\{\(\) => open\("group", group\.id, product\.id, group\)\}/);
  assert.match(catalog,/Quản lý thư viện nhóm/);
});
test("L03 keeps new photo and topping drafts in a single active edit modal",()=>{
  assert.match(library,/Gắn nhóm vào món \(\{selectedProducts\.length\} đã chọn\)/);
  assert.match(library,/Đã tạo bản nháp, gắn vào/);
  assert.match(library,/Lưu & tiếp tục/);
  assert.match(library,/pickMedia\(editing\.kind==="group"\?"groups":"options"/);
  assert.match(library,/product-assignments/);
  assert.match(catalog,/Chọn \/ thay ảnh món/);
  assert.match(catalog,/!!notice && <Notice text=\{notice\} \/>/);
});

test("L03 publication has explanatory prerequisites instead of a failing toggle",()=>{
  assert.match(library,/export function publicationBlockers/);
  assert.match(library,/disabled=\{cannotEnable\}/);
  assert.match(library,/Để bật nhóm:/);
  assert.match(library,/Không thể tắt topping bắt buộc/);
  assert.match(library,/group\.options\.filter\(o=>o\.isAvailable\)\.length<=group\.minSelect/);
  assert.match(library,/Giá topping 0đ vẫn hợp lệ/);
});
test("L03 editing groups has required selector, independent photos and mobile-size checkboxes",()=>{
  assert.match(library,/accessibilityLabel="Bắt buộc khách chọn"/);
  assert.match(library,/min:Number\(old\.min\)>0\?"0":"1"/);
  assert.match(library,/editing\.kind==="group"\?"groups":"options"/);
  assert.match(library,/Ảnh \{editing\.kind==="group"/);
  assert.match(library,/checkBox:\{width:28,height:28/);
  assert.match(library,/checkRow:\{minHeight:56/);
});

test("group editing verifies assigned product edges on refreshed server catalog",()=>{
  assert.match(library,/const latest=await request<AdminCatalog>\(root,token\)/);
  assert.match(library,/const verified=await request<AdminCatalog>\(root,token\)/);
  assert.match(library,/Liên kết nhóm chưa được xác nhận trên máy chủ/);
  assert.match(library,/bật bán để xuất hiện trong app khách/);
});
