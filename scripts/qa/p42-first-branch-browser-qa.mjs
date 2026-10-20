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
  await page.getByRole("button", { name: "Chọn Tỉnh/Thành phố" }).click();
  await page.getByRole("radio", { name: /Hồ Chí Minh/ }).click();
  await page.getByRole("button", { name: "Chọn Phường/Xã/Đặc khu" }).click();
  await page.getByRole("radio", { name: /Thủ Dầu Một/ }).click();
  await page.getByRole("button", { name: "Tạo chi nhánh", exact: true }).click();
  await page.getByText("Đã tạo chi nhánh. Mở Quản lý", { exact: false }).waitFor();
  const branch = await db.branch.findUniqueOrThrow({ where: { code } });
  assert.equal(branch.address, "12 Nguyễn Huệ, Quận 1, TP HCM");
  assert.equal(branch.isActive, false);
  await page.getByRole("button", { name: "Mở Quản lý" }).waitFor();
  await page.getByRole("button", { name: "Mở Giờ bán" }).click();
  await page.getByRole("switch", { name: "Mở cửa Thứ hai" }).click();
  // Opening a previously closed day must seed valid times, not 00:00–00:00.
  await page.getByRole("button", { name: "Giờ mở Thứ hai" }).waitFor();
  assert.match(await page.getByRole("button", { name: "Giờ mở Thứ hai" }).innerText(), /08:00/);
  await page.getByRole("button", { name: "Giờ mở Thứ hai" }).click();
  await page.getByRole("button", { name: "Chọn giờ 09" }).click();
  await page.getByRole("button", { name: "Áp dụng giờ" }).click();
  await page.getByRole("button", { name: "Giờ đóng Thứ hai" }).click();
  await page.getByRole("button", { name: "Chọn giờ 22" }).click();
  await page.getByRole("button", { name: "Chọn phút 15" }).click();
  await page.getByRole("button", { name: "Áp dụng giờ" }).click();
  // A second opened day must not silently invalidate the entire weekly form.
  await page.getByRole("switch", { name: "Mở cửa Thứ ba" }).click();
  await page.getByRole("button", { name: "Giờ mở Thứ ba" }).waitFor();
  await page.getByRole("button", { name: "Giờ đóng Thứ ba" }).waitFor();
  // Invalid time on a day above the viewport must identify that exact weekday.
  await page.getByRole("button", { name: "Giờ đóng Thứ ba" }).click();
  await page.getByRole("button", { name: "Chọn giờ 07" }).click();
  await page.getByRole("button", { name: "Áp dụng giờ" }).click();
  await page.getByText("Thứ ba: Giờ đóng phải sau giờ mở trong cùng ngày.").first().waitFor();
  await page.getByRole("button", { name: "Lưu lịch cửa hàng" }).click();
  assert.equal(await db.branchOpeningHour.count({ where: { branchId: branch.id } }), 0,
    "Invalid draft must not be saved");
  await page.getByRole("button", { name: "Giờ đóng Thứ ba" }).click();
  await page.getByRole("button", { name: "Chọn giờ 21" }).click();
  await page.getByRole("button", { name: "Áp dụng giờ" }).click();
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

  // Management is its own screen opened from the header; workflow modals remain separate.
  await page.getByRole("button", { name: "Đóng popup" }).click();
  await page.getByRole("button", { name: "Mở Phí giao" }).click();
  await page.getByText("Chưa thiết lập phí giao.", { exact: false }).waitFor();
  // Configure an immutable administrative-zone rate instead of a road-km tier.
  for (const [name, value] of [
    ["Giá trị đơn tối thiểu (VND)", "50000"],
    ["Tên vùng thương mại", "Trung tâm"],
    ["Phí giao vùng (VND)", "15000"],
  ]) await page.getByRole("textbox", { name }).fill(value);
  await page.getByRole("button", { name: "Chọn Tỉnh/Thành phố" }).click();
  await page.getByRole("radio", { name: /Hồ Chí Minh/ }).click();
  await page.getByRole("button", { name: "Chọn các phường/xã" }).click();
  await page.getByRole("checkbox", { name: /Thủ Dầu Một/ }).click();
  await page.getByRole("checkbox", { name: /Phú Lợi/ }).click();
  await page.getByRole("button", { name: "Áp dụng" }).click();
  await page.getByRole("button", { name: "Thêm vùng vào danh sách" }).click();
  await page.getByText("Trung tâm · 15.000 đ").waitFor();
  await page.getByRole("button", { name: "Lưu chính sách phí vùng" }).click();
  await page.getByText("Đã lưu chính sách phí vùng phiên bản 1", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Đóng popup" }).click();
  // Activation requires a saved policy + hours, but does not silently opt in to accepting orders.
  await page.getByRole("button", { name: "Mở Hoạt động" }).click();
  await page.getByRole("switch", { name: "Kích hoạt chi nhánh" }).click();
  assert.equal((await db.branch.findUniqueOrThrow({ where: { id: branch.id } })).isActive, false,
    "Switch confirmation must not mutate branch before consent");
  await page.getByRole("button", { name: "Xác nhận thay đổi" }).click();
  await page.getByRole("button", { name: "Mở Hoạt động" }).click();
  await page.getByText("Chi nhánh đã kích hoạt.", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Đóng popup" }).click();
  await page.getByRole("button", { name: "Mở Nhận đơn" }).click();
  await page.getByRole("switch", { name: "Cho phép nhận đơn" }).click();
  assert.equal(await db.deliveryPolicyVersion.count({ where: { branchId: branch.id } }), 1,
    "Acceptance must remain draft until user saves");
  await page.getByRole("button", { name: "Lưu chính sách phí vùng" }).click();
  await page.getByText("Đã lưu chính sách phí vùng phiên bản 2", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Đóng popup" }).click();
  assert.equal((await db.branch.findUniqueOrThrow({ where: { id: branch.id } })).isActive, true);
  const policy = await db.deliveryPolicyVersion.findFirst({
    where: { branchId: branch.id }, orderBy: { version: "desc" },
    include: { zones: true },
  });
  assert.equal(policy?.acceptingOrders, true);
  assert.equal(policy?.pricingMode, "ZONE");
  assert.equal(policy?.baseMeters, null, "Zone rate never writes fake road meters");
  assert.equal(policy?.zones.length, 1);
  assert.equal(policy?.zones[0].feeVnd, 15000);
  assert.deepEqual(policy?.zones[0].wardCodes, ["25747", "25750"]);
  for (const width of [320, 360, 390, 428]) {
    await page.setViewportSize({ width, height: 780 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  }
  // Leave the disposable QA branch closed so customer tests see only their own stores.
  await page.getByRole("button", { name: "Mở Hoạt động" }).click();
  await page.getByRole("switch", { name: "Kích hoạt chi nhánh" }).click();
  await page.getByRole("button", { name: "Xác nhận thay đổi" }).click();
  await page.getByRole("button", { name: "Mở Hoạt động" }).click();
  await page.getByText("Chi nhánh đang tạm dừng.", { exact: false }).waitFor();
  assert.equal((await db.branch.findUniqueOrThrow({ where: { id: branch.id } })).isActive, false);
  assert.deepEqual(errors, []);
  await context.close();
  console.log("PASS P4.2 first-branch onboarding / real policy / activation");
} finally {
  await browser.close();
  await db.$disconnect();
}
