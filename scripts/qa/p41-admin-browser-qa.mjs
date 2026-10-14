import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");
const { hash } = require("@node-rs/argon2");
const db = new PrismaClient();
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
mkdirSync("apps/admin/qa-artifacts", { recursive: true });
const web = "http://127.0.0.1:3002";
const api = "http://127.0.0.1:3001";
try {
  // All staff/accounts below are created ONLY in disposable CI PostgreSQL.
  const branch = await db.branch.create({ data: {
    code: "ADM" + randomUUID().replaceAll("-", "").slice(0, 16),
    name: "Chi nhánh QA Admin", latitude: "10.1234567", longitude: "106.7654321",
  } });
  const username = "admin" + randomUUID().replaceAll("-", "").slice(0, 15);
  const password = "admin123";
  const staff = await db.user.create({ data: { role: "MANAGER" } });
  await db.localCredential.create({ data: { userId: staff.id,
    normalizedUsername: username, passwordHash: await hash(password),
    verifiedEmail: username + "@example.test" } });
  await db.branchMember.create({ data: { userId: staff.id, branchId: branch.id, role: "MANAGER" } });

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(web, { waitUntil: "domcontentloaded" });
  await page.getByRole("textbox", { name: "Tên đăng nhập" }).fill(username);
  await page.getByRole("textbox", { name: "Mật khẩu" }).fill(password);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.getByText("Chi nhánh QA Admin").waitFor();

  await page.getByRole("tab", { name: "Thực đơn" }).click();
  await page.getByRole("button", { name: "＋ Danh mục" }).click();
  await page.getByRole("textbox", { name: "Tên", exact: true }).fill("Lẩu & món chính");
  await page.getByRole("button", { name: "Lưu thay đổi" }).click();
  await page.getByText("Lẩu & món chính").waitFor();
  await page.getByRole("button", { name: "＋ Món" }).click();
  await page.getByRole("textbox", { name: "Tên", exact: true }).fill("Lẩu QA P4.1");
  await page.getByRole("textbox", { name: "Giá bán (VND)" }).fill("179000");
  await page.getByRole("button", { name: "Lưu thay đổi" }).click();
  await page.getByRole("button", { name: "Xem chi tiết Lẩu QA P4.1" }).waitFor();
  await page.getByRole("button", { name: "Tạm hết Lẩu QA P4.1" }).click();
  await page.getByRole("button", { name: "Bật bán Lẩu QA P4.1" }).waitFor();

  await page.getByRole("button", { name: "Xem chi tiết Lẩu QA P4.1" }).click();
  await page.getByRole("button", { name: "＋ Size" }).click();
  await page.getByRole("textbox", { name: "Tên", exact: true }).fill("Phần hai người");
  await page.getByRole("textbox", { name: "Phụ thu (VND)" }).fill("49000");
  await page.getByRole("button", { name: "Lưu thay đổi" }).click();
  await page.getByText("Phần hai người", { exact: false }).waitFor();

  await page.getByRole("button", { name: "＋ Nhóm" }).click();
  await page.getByRole("textbox", { name: "Tên", exact: true }).fill("Độ cay");
  await page.getByRole("textbox", { name: "Chọn tối thiểu" }).fill("1");
  await page.getByRole("textbox", { name: "Chọn tối đa" }).fill("1");
  await page.getByRole("button", { name: "Lưu thay đổi" }).click();
  await page.getByText("Độ cay (1–1)").waitFor();
  await page.getByRole("button", { name: "＋ Chọn" }).click();
  await page.getByRole("textbox", { name: "Tên", exact: true }).fill("Cay vừa");
  await page.getByRole("button", { name: "Lưu thay đổi" }).click();
  await page.getByText("Cay vừa", { exact: false }).waitFor();

  await page.getByRole("tab", { name: "Giờ bán" }).click();
  await page.getByRole("button", { name: "Nghỉ" }).nth(1).click();
  await page.getByRole("textbox", { name: "Giờ mở Thứ hai" }).fill("09:00");
  await page.getByRole("textbox", { name: "Giờ đóng Thứ hai" }).fill("22:00");
  await page.getByRole("button", { name: "Lưu lịch cửa hàng" }).click();
  await page.getByText("Đã lưu lịch mở cửa cho chi nhánh.").waitFor();

  for (const width of [320, 360, 390, 428]) {
    await page.setViewportSize({ width, height: 844 });
    for (const tab of ["Tổng quan", "Thực đơn", "Giờ bán"]) {
      await page.getByRole("tab", { name: tab }).click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        true, "Admin horizontal overflow in " + tab + " at " + width);
      const selector = tab === "Tổng quan" ? "Tổng quan cửa hàng" :
        tab === "Thực đơn" ? "Tìm món" : "Giờ bán";
      await page.getByText(selector).first().waitFor();
      await page.screenshot({ path: "apps/admin/qa-artifacts/p41-" +
        tab.replace(/\s/g, "-") + "-" + width + ".png" });
    }
    const headings = await page.locator("h1, h2").count();
    assert.equal(headings, 0, "Admin uses compact RN typography, not browser default headings");
  }
  assert.deepEqual(errors, []);
  console.log("PASS: Admin role-based sign-in, CRUD, stock, size, topping, hours, 320/360/390/428");

  const forbidden = await db.user.create({ data: { role: "CUSTOMER" } });
  const customerUsername = "customer" + randomUUID().replaceAll("-", "").slice(0, 12);
  await db.localCredential.create({ data: { userId: forbidden.id,
    normalizedUsername: customerUsername, passwordHash: await hash(password),
    verifiedEmail: customerUsername + "@example.test" } });
  const login = await fetch(api + "/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: customerUsername, password }),
  });
  assert.equal(login.status, 201);
  const credentials = await login.json();
  const denied = await fetch(api + "/admin/branches", {
    headers: { Authorization: "Bearer " + credentials.accessToken },
  });
  assert.equal(denied.status, 403);
  console.log("PASS: CUSTOMER cannot enumerate Admin branch data");
  await ctx.close();
} finally {
  await browser.close();
  await db.$disconnect();
}
