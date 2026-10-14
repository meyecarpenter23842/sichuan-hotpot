import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");

test("edit existing saved address uses PATCH with identity, never POST, no duplicate", () => {
  assert.match(api, /"PATCH"/);
  assert.match(app, /setEditingAddressId\(saved\.id\)/);
  assert.match(app, /method: editingAddressId \? "PATCH" : "POST"/);
  assert.match(app, /old\.map\(item => item\.id === saved\.id \? saved : item\)/);
  assert.match(app, /editingAddressId \? "Cập nhật địa chỉ"/);
  assert.match(app, /accessibilityLabel=\{"Sửa địa chỉ " \+ saved\.label\}/);
  assert.match(app, /addressBeforeModal\.current = address/);
  assert.match(app, /setEditingAddressId\(null\)/);
});

test("account orders share one flat divider section, no nested framed Button components", () => {
  assert.match(app, /accountOrdersSection: \{ backgroundColor: palette\.white/);
  assert.match(app, /accountOrderRow: \{ flexDirection: "row"/);
  assert.match(app, /borderBottomColor: "#EEF0F3"/);
  assert.match(app, /accessibilityLabel="Sản phẩm đã mua"/);
  assert.match(app, /accessibilityLabel="Lịch sử và theo dõi đơn hàng"/);
  const start = app.indexOf('<View style={styles.accountOrdersSection}>');
  const end = app.indexOf('</View>', app.indexOf('onPress={() => setScreen("orders")}', start)) + 7;
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(app.slice(start, end), /<Button label=/);
});
