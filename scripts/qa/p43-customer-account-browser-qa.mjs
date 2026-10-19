import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium } from "playwright";
const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");
const { hash } = require("@node-rs/argon2");
const db = new PrismaClient();
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const output = "apps/customer/qa-artifacts";
mkdirSync(output, { recursive: true });
try {
  const user = await db.user.create({ data: { role: "CUSTOMER" } });
  const username = "address" + randomUUID().replaceAll("-", "").slice(0, 12);
  const secret = "Qa123456"; // Customer login input is intentionally limited to 8 characters.
  await db.localCredential.create({ data: { userId: user.id,
    normalizedUsername: username, passwordHash: await hash(secret),
    verifiedEmail: username + "@example.test" } });
  const context = await browser.newContext({ viewport: { width: 360, height: 780 } });
  const page = await context.newPage();
  const exceptions = [];
  page.on("pageerror", error => exceptions.push(error.message));
  await page.goto("http://127.0.0.1:3000", { waitUntil: "domcontentloaded" });
  await page.getByRole("textbox", { name: "Tên đăng nhập" }).fill(username);
  await page.getByRole("textbox", { name: "Mật khẩu" }).fill(secret);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).last().click();
  await page.getByRole("tab", { name: "Tôi" }).click();
  await page.getByText("Tài khoản khách hàng").waitFor();
  const bought = page.getByRole("button", { name: "Sản phẩm đã mua" });
  const history = page.getByRole("button", { name: "Lịch sử và theo dõi đơn hàng" });
  await bought.waitFor();
  await history.waitFor();
  // Both actions live in a single flat section with dividers, not boxed buttons.
  const style = await bought.evaluate(node => {
    const parent = node.parentElement;
    return {
      parentBorder: getComputedStyle(parent).borderTopWidth,
      rowBorder: getComputedStyle(node).borderBottomWidth,
    };
  });
  assert.equal(style.parentBorder, "0px", "Orders section must not be a nested bordered card");
  assert.equal(style.rowBorder, "1px", "Order navigation should be flat divider rows");
  await page.getByRole("button", { name: "＋ Thêm địa chỉ" }).click();
  const fields = [
    ["Tên gợi nhớ (Nhà, Công ty...)", "Nhà"],
    ["Số điện thoại", "0912345678"],
    ["Số nhà, tên đường và ghi chú giao", "414/7 Ấp 03A Đạo Thạnh"],
    ["Vĩ độ (latitude)", "10.1234567"],
    ["Kinh độ (longitude)", "106.1234567"],
  ];
  for (const [name, value] of fields) {
    await page.getByRole("textbox", { name }).fill(value);
  }
  await page.getByRole("button", { name: "Chọn Tỉnh/Thành phố" }).click();
  await page.getByRole("radio", { name: /Hồ Chí Minh/ }).click();
  await page.getByRole("button", { name: "Chọn Phường/Xã/Đặc khu" }).click();
  await page.getByRole("radio", { name: /Thủ Dầu Một/ }).click();
  await page.getByRole("button", { name: "Lưu địa chỉ vào tài khoản" }).click();
  await page.getByRole("button", { name: "Sửa địa chỉ Nhà" }).waitFor();
  assert.equal(await db.address.count({ where: { userId: user.id } }), 1);
  await page.getByRole("button", { name: "Sửa địa chỉ Nhà" }).click();
  assert.equal(await page.getByRole("textbox", { name: "Số nhà, tên đường và ghi chú giao" }).inputValue(),
    "414/7 Ấp 03A Đạo Thạnh");
  await page.getByRole("textbox", { name: "Số nhà, tên đường và ghi chú giao" })
    .fill("414/7 Ấp 03B Đạo Thạnh");
  await page.getByRole("button", { name: "Cập nhật địa chỉ" }).click();
  await page.getByText("414/7 Ấp 03B Đạo Thạnh").waitFor();
  const rows = await db.address.findMany({ where: { userId: user.id } });
  assert.equal(rows.length, 1, "Address edit must update, not insert");
  assert.equal(rows[0].line1, "414/7 Ấp 03B Đạo Thạnh");
  // A canceled edit does not overwrite saved data or local selection.
  await page.getByRole("button", { name: "Sửa địa chỉ Nhà" }).click();
  await page.getByRole("textbox", { name: "Số nhà, tên đường và ghi chú giao" })
    .fill("Địa chỉ chưa lưu");
  await page.getByRole("button", { name: "Hủy", exact: true }).click();
  assert.equal((await db.address.findUniqueOrThrow({ where: { id: rows[0].id } })).line1,
    "414/7 Ấp 03B Đạo Thạnh");
  for (const width of [320, 360, 390, 428]) {
    await page.setViewportSize({ width, height: 780 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      "Account/address layout overflows at " + width);
    await page.screenshot({ path: output + "/p43-account-address-" + width + ".png" });
  }
  await history.click();
  await page.getByText("Đơn hàng của tôi").waitFor();
  const purchasesTab = page.getByRole("tab", { name: "Món đã mua", exact: true });
  await purchasesTab.waitFor();
  await purchasesTab.click();
  await page.getByText("Các món đã nhận", { exact: true }).waitFor();
  await page.getByRole("tab", { name: "Đơn hàng", exact: true }).first().click();
  await page.getByText("Đơn hàng của tôi").waitFor();
  await page.getByRole("tab", { name: "Tôi" }).click();
  await bought.click();
  await page.getByText("Các món đã nhận", { exact: true }).waitFor();
  for (const width of [320, 360, 390, 428]) {
    await page.setViewportSize({ width, height: 780 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      "Purchased order sub-tab overflows at " + width);
    await page.screenshot({ path: output + "/l03-purchased-tab-" + width + ".png" });
  }
  assert.deepEqual(exceptions, []);
  await context.close();
  console.log("PASS P4.3 / L03: address PATCH, flat account navigation, sticky orders/purchases tab interactions");
} finally {
  await browser.close();
  await db.$disconnect();
}
