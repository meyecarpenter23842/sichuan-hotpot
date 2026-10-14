import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

test("address manager has its own compact header and no obstructing tab bar", () => {
  assert.match(app, /screen === "address" \? \(/);
  assert.match(app, /Địa điểm đã lưu/);
  assert.match(app, /accessibilityLabel="Quay lại từ địa chỉ đã lưu"/);
  assert.match(app, /screen !== "address" && <View style=\{styles\.bottomNavigation\}/);
  assert.match(app, /addressBody: \{ paddingBottom: 0 \}/);
});

test("saved addresses are genuine account records, not hardcoded examples", () => {
  assert.match(app, /function savedAddressCards\(returnTo: "cart" \| "account", compact = false\)/);
  assert.match(app, /displayed\.map\(saved =>/);
  assert.match(app, /isSelected && styles\.savedAddressSelected/);
  assert.match(app, /Đang dùng/);
  assert.match(app, /savedAddresses\.length \+ "\/10"/);
  assert.match(app, /accessibilityLabel=\{"Dùng địa chỉ " \+ saved\.label\}/);
  assert.match(app, /accessibilityLabel=\{"Xem ghim " \+ saved\.label\}/);
  assert.match(app, /accessibilityLabel=\{"Xóa địa chỉ " \+ saved\.label\}/);
});

test("three quick add actions initialize the actual validation and map modal", () => {
  assert.match(app, /Thêm Nhà riêng/);
  assert.match(app, /Thêm Văn phòng/);
  assert.match(app, /title: "Thêm", label: "Khác", icon: "\+"/);
  assert.match(app, /item\.title === "Thêm Nhà riêng"/);
  assert.match(app, /Lưu địa chỉ thường dùng/);
  assert.match(app, /onPress=\{\(\) => openAddressEditor\(addressReturnTo, item\.label\)\}/);
  assert.match(app, /setAddress\(\{ label, phone: address\.phone, line1: "", latitude: "", longitude: "" \}\)/);
  assert.match(app, /<AddressPinMap latitude=\{address\.latitude\}/);
  assert.match(app, /addressError\(address\.line1, address\.latitude, address\.longitude\)/);
  assert.match(app, /setSelectedAddressId\(saved\.id\)/);
});

test("address list uses divider rows and subtle selection, not nested heavy cards", () => {
  assert.match(app, /savedAddress: \{ flexDirection: "row"/);
  assert.match(app, /borderBottomColor: "#EEF0F3"/);
  assert.match(app, /savedAddressSelected: \{ borderLeftColor: palette\.red/);
  assert.doesNotMatch(app, /savedAddressSelected: \{ borderColor: palette\.red, backgroundColor: palette\.softRed \}/);
});

test("address deletion requires explicit confirmation and 44px targets", () => {
  assert.match(app, /setPendingDeleteAddress\(saved\)/);
  assert.match(app, /visible=\{!!pendingDeleteAddress\}/);
  assert.match(app, /accessibilityLabel="Xác nhận xóa địa chỉ"/);
  assert.match(app, /addressPinButton: \{ width: 44, height: 44/);
  assert.match(app, /addressSmallButton: \{ width: 44, minHeight: 44/);
});
