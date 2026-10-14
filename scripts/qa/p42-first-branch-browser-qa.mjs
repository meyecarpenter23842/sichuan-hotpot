import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { chromium } from "playwright";
const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");
const { hash } = require("@node-rs/argon2");
const db = new PrismaClient();
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
try {
  assert.equal(await db.branch.count(), 0, "first-store QA must run before fixtures");
  const owner = await db.user.create({ data: { role: "OWNER" } });
  const username = "setup" + randomUUID().replaceAll("-", "").slice(0, 12);
  const secret = randomUUID() + "Aa1";
  await db.localCredential.create({ data: {
    userId: owner.id, normalizedUsername: username,
    passwordHash: await hash(secret), verifiedEmail: username + "@example.test",
  } });
  const context = await browser.newContext({ viewport: { width: 360, height: 780 },
    permissions: ["geolocation"],
    geolocation: { latitude: 10.7731, longitude: 106.7032 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("http://127.0.0.1:3002", { waitUntil: "domcontentloaded" });
  await page.getByRole("textbox", { name: "Tên đăng nhập" }).fill(username);
  await page.getByRole("textbox", { name: "Mật khẩu" }).fill(secret);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.getByText("Khởi tạo cửa hàng đầu tiên").waitFor();
  await page.getByRole("button", { name: "Tạo chi nhánh đầu tiên" }).click();
  const code = "qa-" + randomUUID().slice(0, 8);
  for (const [field, value] of [
    ["Tên cửa hàng", "Chi nhánh đầu tiên"],
    ["Mã chi nhánh (không dấu, chữ thường)", code],
    ["Địa chỉ cửa hàng", "12 Nguyễn Huệ, Quận 1, TP HCM"],
    ["Vĩ độ (latitude)", "10.7731000"],
    ["Kinh độ (longitude)", "106.7032000"],
  ]) await page.getByRole("textbox", { name: field }).fill(value);
  // GPS is requested only after a tap; the coordinates must match the consented device.
  await page.getByRole("button", { name: "Lấy định vị GPS hiện tại" }).click();
  await page.getByText("Đã lấy vị trí thiết bị.", { exact: false }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Vĩ độ (latitude)" }).inputValue(), "10.7731000");
  assert.equal(await page.getByRole("textbox", { name: "Kinh độ (longitude)" }).inputValue(), "106.7032000");
  await page.getByRole("button", { name: "Tạo chi nhánh", exact: true }).click();
  await page.getByText("Đã tạo chi nhánh thật.", { exact: false }).waitFor();
  const branch = await db.branch.findUniqueOrThrow({ where: { code } });
  assert.equal(branch.address, "12 Nguyễn Huệ, Quận 1, TP HCM");
  assert.equal(branch.isActive, false);
  await page.getByRole("button", { name: "Nghỉ" }).nth(1).click();
  // Opening a previously closed day must seed valid times, not 00:00–00:00.
  await page.getByRole("button", { name: "Giờ mở Thứ hai" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Giờ mở Thứ hai" }).innerText(), "08:00⌄");
  await page.getByRole("button", { name: "Giờ mở Thứ hai" }).click();
  await page.getByRole("button", { name: "Chọn giờ 09" }).click();
  await page.getByRole("button", { name: "Áp dụng giờ" }).click();
  await page.getByRole("button", { name: "Giờ đóng Thứ hai" }).click();
  await page.getByRole("button", { name: "Chọn giờ 22" }).click();
  await page.getByRole("button", { name: "Chọn phút 15" }).click();
  await page.getByRole("button", { name: "Áp dụng giờ" }).click();
  // A second opened day must not silently invalidate the entire weekly form.
  await page.getByRole("button", { name: "Nghỉ" }).nth(1).click();
  await page.getByRole("button", { name: "Giờ mở Thứ ba" }).waitFor();
  await page.getByRole("button", { name: "Giờ đóng Thứ ba" }).waitFor();
  await page.getByRole("button", { name: "Lưu lịch cửa hàng" }).click();
  await page.getByText("Đã lưu lịch mở cửa cho chi nhánh.").waitFor();
  const savedHours = await db.branchOpeningHour.findMany({
    where: { branchId: branch.id }, orderBy: { weekday: "asc" },
  });
  assert.equal(savedHours.length, 7, "A complete 7-day schedule must persist");
  assert.equal(savedHours[1].opensAt, "09:00");
  assert.equal(savedHours[1].closesAt, "22:15");
  assert.equal(savedHours[2].opensAt, "08:00");
  assert.equal(savedHours[2].closesAt, "21:00");

  await page.getByRole("tab", { name: "Tổng quan" }).click();
  await page.getByRole("button", { name: "Cấu hình chi nhánh" }).click();
  await page.getByText("Chưa cấu hình phí giao.", { exact: false }).waitFor();
  const fees = [
    ["Số mét giao cơ bản", "3000"], ["Phí giao cơ bản (VND)", "15000"],
    ["Bước phụ thu (mét)", "1000"], ["Phụ thu mỗi bước (VND)", "5000"],
    ["Khoảng cách đường tối đa (mét)", "12000"],
    ["Đơn hàng tối thiểu (VND)", "50000"],
  ];
  for (const [name, value] of fees) {
    await page.getByRole("textbox", { name }).fill(value);
  }
  await page.getByRole("button", { name: "Nhận đơn", exact: true }).click();
  await page.getByRole("button", { name: "Lưu chính sách giao hàng" }).click();
  await page.getByText("Đã lưu phiên bản 1", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Kích hoạt chi nhánh" }).click();
  await page.getByRole("button", { name: "Xác nhận đổi trạng thái" }).click();
  await page.getByText("Chi nhánh đã kích hoạt.").waitFor();
  assert.equal((await db.branch.findUniqueOrThrow({ where: { id: branch.id } })).isActive, true);
  const policy = await db.deliveryPolicyVersion.findFirst({ where: { branchId: branch.id } });
  assert.equal(policy?.acceptingOrders, true);
  for (const width of [320, 360, 390, 428]) {
    await page.setViewportSize({ width, height: 780 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  }
  // Leave the disposable QA branch closed so customer tests see only their own stores.
  await page.getByRole("button", { name: "Tạm dừng chi nhánh" }).click();
  await page.getByRole("button", { name: "Xác nhận đổi trạng thái" }).click();
  await page.getByText("Đã tạm dừng chi nhánh.").waitFor();
  assert.equal((await db.branch.findUniqueOrThrow({ where: { id: branch.id } })).isActive, false);
  assert.deepEqual(errors, []);
  await context.close();
  console.log("PASS P4.2 first-branch onboarding / real policy / activation");
} finally {
  await browser.close();
  await db.$disconnect();
}
