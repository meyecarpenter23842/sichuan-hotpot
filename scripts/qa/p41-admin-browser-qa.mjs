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
  // Real branch managers can have global CUSTOMER role.
  const staff = await db.user.create({ data: { role: "CUSTOMER" } });
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
  await page.getByRole("button", { name: "Xem chi tiết Lẩu QA P4.1" }).click();
  await page.getByText("Phần hai người", { exact: false }).waitFor();

  await page.getByRole("button", { name: "＋ Nhóm" }).click();
  await page.getByRole("textbox", { name: "Tên", exact: true }).fill("Độ cay");
  await page.getByRole("textbox", { name: "Chọn tối thiểu" }).fill("1");
  await page.getByRole("textbox", { name: "Chọn tối đa" }).fill("1");
  await page.getByRole("button", { name: "Lưu thay đổi" }).click();
  await page.getByRole("button", { name: "Xem chi tiết Lẩu QA P4.1" }).click();
  await page.getByText("Độ cay (1–1)").waitFor();
  await page.getByRole("button", { name: "＋ Chọn" }).click();
  await page.getByRole("textbox", { name: "Tên", exact: true }).fill("Cay vừa");
  await page.getByRole("button", { name: "Lưu thay đổi" }).click();
  await page.getByRole("button", { name: "Xem chi tiết Lẩu QA P4.1" }).click();
  await page.getByText("Cay vừa", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Đóng chi tiết món" }).click();

  await page.getByRole("tab", { name: "Thiết lập" }).click();
  await page.getByRole("button", { name: "Mở Giờ bán" }).click();
  await page.getByRole("button", { name: "Nghỉ" }).nth(1).click();
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
  await page.getByRole("button", { name: "Nghỉ" }).nth(1).click();
  await page.getByRole("button", { name: "Giờ mở Thứ ba" }).waitFor();
  await page.getByRole("button", { name: "Giờ đóng Thứ ba" }).waitFor();
  await page.getByRole("button", { name: "Lưu lịch cửa hàng" }).click();
  await page.getByText("Đã lưu lịch mở cửa cho chi nhánh.").waitFor();
  await page.getByRole("button", { name: "Đóng popup" }).click();
  const savedHours = await db.branchOpeningHour.findMany({
    where: { branchId: branch.id }, orderBy: { weekday: "asc" },
  });
  assert.equal(savedHours.length, 7, "A complete 7-day schedule must persist");
  assert.equal(savedHours[1].opensAt, "09:00");
  assert.equal(savedHours[1].closesAt, "22:15");
  assert.equal(savedHours[2].opensAt, "08:00");
  assert.equal(savedHours[2].closesAt, "21:00");


  for (const width of [320, 360, 390, 428]) {
    await page.setViewportSize({ width, height: 844 });
    for (const tab of ["Tổng quan", "Thực đơn", "Thiết lập"]) {
      await page.getByRole("tab", { name: tab }).click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        true, "Admin horizontal overflow in " + tab + " at " + width);
      if (tab === "Thiết lập") {
        await page.getByRole("button", { name: "Mở Giờ bán" }).waitFor();
      } else {
        await page.getByText(tab === "Tổng quan" ? "Tổng quan cửa hàng" : "Tìm món").first().waitFor();
      }
      await page.screenshot({ path: "apps/admin/qa-artifacts/p41-" +
        tab.replace(/\s/g, "-") + "-" + width + ".png" });
    }
    const headings = await page.locator("h1, h2").count();
    assert.equal(headings, 0, "Admin uses compact RN typography, not browser default headings");
  }
  assert.deepEqual(errors, []);
  console.log("PASS: Admin role-based sign-in, flat catalog detail modal, size, topping, settings hours, 320/360/390/428");

  // Exercise real OWNER and branch-scoped MANAGER permissions on disposable CI DB only.
  // The Admin login endpoint intentionally accepts passwords longer than the
  // separate 6–8 character CUSTOMER registration rule.
  const otherBranch = await db.branch.create({ data: {
    code: "OWN" + randomUUID().replaceAll("-", "").slice(0, 16),
    name: "Chi nhánh Owner QA", latitude: "10.2345678", longitude: "106.8765432",
  } });
  const managerLogin = await fetch(api + "/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(managerLogin.status, 201);
  const managerTokens = await managerLogin.json();
  const managerHeaders = { Authorization: "Bearer " + managerTokens.accessToken };
  const managerBranchesResponse = await fetch(api + "/admin/branches", { headers: managerHeaders });
  assert.equal(managerBranchesResponse.status, 200);
  const managerBranches = await managerBranchesResponse.json();
  assert.deepEqual(managerBranches.map(x => x.id), [branch.id]);
  const deniedOtherBranch = await fetch(api + "/admin/branches/" + otherBranch.id + "/catalog",
    { headers: managerHeaders });
  assert.equal(deniedOtherBranch.status, 403);

  const ownerUsername = "owner" + randomUUID().replaceAll("-", "").slice(0, 15);
  const ownerPassword = "owner9!xZ"; // CI-only nine-character fixture, never a production credential.
  assert.equal(ownerPassword.length, 9);
  const owner = await db.user.create({ data: { role: "OWNER" } });
  await db.localCredential.create({ data: { userId: owner.id,
    normalizedUsername: ownerUsername, passwordHash: await hash(ownerPassword),
    verifiedEmail: ownerUsername + "@example.test" } });
  const ownerLogin = await fetch(api + "/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: ownerUsername, password: ownerPassword }),
  });
  assert.equal(ownerLogin.status, 201);
  const ownerTokens = await ownerLogin.json();
  const ownerHeaders = { Authorization: "Bearer " + ownerTokens.accessToken };
  const ownerMeResponse = await fetch(api + "/auth/me", { headers: ownerHeaders });
  assert.equal(ownerMeResponse.status, 200);
  assert.equal((await ownerMeResponse.json()).role, "OWNER");
  const ownerBranchesResponse = await fetch(api + "/admin/branches", { headers: ownerHeaders });
  assert.equal(ownerBranchesResponse.status, 200);
  const ownerBranches = await ownerBranchesResponse.json();
  const allBranchIds = new Set((await db.branch.findMany({ select: { id: true } })).map(x => x.id));
  assert.ok(allBranchIds.has(branch.id) && allBranchIds.has(otherBranch.id));
  assert.deepEqual(new Set(ownerBranches.map(x => x.id)), allBranchIds);
  const ownerCatalogResponse = await fetch(api + "/admin/branches/" + otherBranch.id + "/catalog",
    { headers: ownerHeaders });
  assert.equal(ownerCatalogResponse.status, 200);

  const ownerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto(web, { waitUntil: "domcontentloaded" });
  await ownerPage.getByRole("textbox", { name: "Tên đăng nhập" }).fill(ownerUsername);
  await ownerPage.getByRole("textbox", { name: "Mật khẩu" }).fill(ownerPassword);
  await ownerPage.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await ownerPage.getByText("Admin · Chủ cửa hàng").waitFor();
  await ownerPage.getByRole("button", { name: "Đổi chi nhánh" }).click();
  await ownerPage.getByRole("button", { name: "Chọn chi nhánh Chi nhánh Owner QA" }).click();
  await ownerPage.getByText("Chi nhánh Owner QA").first().waitFor();
  await ownerContext.close();
  console.log("PASS: nine-character OWNER sign-in, both branches; MANAGER denied other branch");

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
