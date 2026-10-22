import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium } from "playwright";

// Hard-stop on production or any shared/staging Postgres. All fixtures are disposable.
const expected = "postgresql://hotpot_ci:hotpot_ci_only@127.0.0.1:5432/hotpot_ci?schema=public";
if (process.env.GITHUB_ACTIONS !== "true" || process.env.DATABASE_URL !== expected)
  throw new Error("L05 browser QA only runs against disposable localhost CI PostgreSQL");
const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");
const { hash } = require("@node-rs/argon2");
const db = new PrismaClient();
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const web = "http://127.0.0.1:3005/";
const api = "http://127.0.0.1:3001";
mkdirSync("apps/menu/qa-artifacts", { recursive: true });
const guestA = await browser.newContext({ viewport: { width: 390, height: 844 } });
const guestB = await browser.newContext({ viewport: { width: 360, height: 740 } });
const page = await guestA.newPage(), other = await guestB.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
other.on("pageerror", error => errors.push(error.message));
try {
  const unique = randomUUID().replaceAll("-", "");
  const branch = await db.branch.create({ data: {
    name: "Menu QA " + unique.slice(0, 8), code: "MENU" + unique.slice(0, 10),
    latitude: "10.1234567", longitude: "106.7654321",
  } });
  const area = await db.diningArea.create({ data: { branchId: branch.id, name: "Tầng 1" } });
  const table = await db.diningTable.create({ data: { branchId: branch.id, areaId: area.id,
    code: "A1", name: "Bàn A1", qrHandle: unique } });
  const category = await db.catalogCategory.create({ data: { branchId: branch.id, name: "Lẩu",
    isPublished: true } });
  const product = await db.product.create({ data: { categoryId: category.id,
    name: "Lẩu QR QA", priceVnd: 250_000, isAvailable: true } });
  const variant = await db.productVariant.create({ data: { productId: product.id,
    name: "Lớn", priceDeltaVnd: 120_000, isAvailable: true } });
  const staff = await db.user.create({ data: { role: "WAITER" } });
  await db.branchMember.create({ data: { userId: staff.id, branchId: branch.id, role: "WAITER" } });
  const username = "menuqa" + unique.slice(0, 12), password = "safe-qa-password";
  await db.localCredential.create({ data: { userId: staff.id,
    normalizedUsername: username, verifiedEmail: username + "@example.test",
    passwordHash: await hash(password) } });
  const href = web + "?table=" + unique;
  // Guests in the dining room share a single Wi-Fi/NAT IP. Normal locator
  // refreshes must not exhaust the protected grant/ticket write-rate budget.
  for (let i = 0; i < 30; i++) {
    const response = await fetch(api + "/dining/qr/" + unique);
    assert.equal(response.status, 200, "shared Wi-Fi QR read " + (i + 1));
  }
  await page.goto(href, { waitUntil: "domcontentloaded" });
  await page.getByText("Bàn chưa mở phiên phục vụ").waitFor();
  assert.equal(await db.diningTicket.count({ where: { branchId: branch.id } }), 0);
  const session = await db.diningSession.create({ data: {
    branchId: branch.id, tableId: table.id, openedById: staff.id,
  } });
  await page.getByRole("button", { name: "Kiểm tra lại" }).click();
  await page.getByTestId("menu-qr-hero").waitFor();
  await page.getByText("Món ngon nóng hổi, gọi ngay tại bàn").waitFor();
  await page.screenshot({ path: "apps/menu/qa-artifacts/home-390.png" });
  await page.getByRole("button", { name: "Chọn Lẩu QR QA" }).waitFor();
  await page.getByRole("button", { name: "Chọn Lẩu QR QA" }).click();
  await page.getByRole("checkbox", { name: "Lớn +120.000đ" }).click();
  await page.getByRole("button", { name: "Thêm 1 vào giỏ" }).click();
  await page.getByRole("button", { name: "Xem giỏ →" }).click();
  await page.getByRole("button", { name: "Tăng số lượng Lẩu QR QA" }).click();
  await page.getByText("740.000đ").first().waitFor();
  assert.equal(await db.diningTicket.count({ where: { sessionId: session.id } }), 0,
    "editing an unsent cart may not create a kitchen ticket");
  await page.getByRole("button", { name: "Giảm số lượng Lẩu QR QA" }).click();
  await page.getByText("370.000đ").first().waitFor();
  await page.screenshot({ path: "apps/menu/qa-artifacts/cart-390.png" });
  await page.getByRole("button", { name: "Gửi yêu cầu gọi món" }).click();
  await page.getByText("Đã gửi yêu cầu #", { exact: false }).waitFor();
  await page.getByText("Đang chờ nhân viên xác nhận", { exact: true }).waitFor();
  const first = await db.diningTicket.findFirstOrThrow({
    where: { branchId: branch.id, sessionId: session.id, source: "QR" },
    include: { items: true },
  });
  assert.equal(first.status, "PENDING_APPROVAL");
  assert.equal(first.items[0].lineTotalVnd, 370_000, "server-priced large variant");
  assert.equal(await db.diningTicket.count({ where: { sessionId: session.id } }), 1);
  await other.goto(href, { waitUntil: "domcontentloaded" });
  await other.getByRole("tab", { name: "Yêu cầu" }).click();
  await other.getByText("Chưa gửi yêu cầu nào.").waitFor();
  await other.getByText("0đ", { exact: false }).first().waitFor();
  // Renew existing guest grant without changing grant/ticket ownership; no auth in URL.
  const auth = await page.evaluate(handle => {
    const raw = sessionStorage.getItem("sichuan-menu-guest-v1-" + handle);
    const data = raw ? JSON.parse(raw) : null;
    return data?.credential;
  }, unique);
  assert.equal(typeof auth, "string");
  const renewed = await fetch(api + "/dining/guest/renew", {
    method: "POST", headers: { Authorization: "Dining " + auth },
  });
  assert.equal(renewed.status, 201);
  const renewal = await renewed.json();
  assert.ok(Date.parse(renewal.expiresAt) > Date.now());
  const login = await fetch(api + "/auth/login", { method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(login.status, 201);
  const tokens = await login.json();
  const approve = await fetch(api + "/dining/branches/" + branch.id + "/tickets/" + first.id + "/approve", {
    method: "POST", headers: { Authorization: "Bearer " + tokens.accessToken },
  });
  assert.equal(approve.status, 201);
  await page.getByRole("button", { name: "Cập nhật trạng thái" }).click();
  await page.getByText("Nhân viên đã xác nhận · Đã gửi Bếp").waitFor();
  await other.getByRole("button", { name: "Cập nhật trạng thái" }).click();
  await other.getByText("370.000đ").waitFor();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "Yêu cầu" }).click();
  await page.getByText("Nhân viên đã xác nhận · Đã gửi Bếp").waitFor();
  assert.equal(await db.diningTicket.count({ where: { sessionId: session.id } }), 1,
    "reload and status sync must not duplicate tickets");
  // An unsent draft must remain in this browser tab after a refresh (no second order).
  await page.getByRole("tab", { name: "Thực đơn" }).click();
  await page.getByRole("button", { name: "Chọn Lẩu QR QA" }).click();
  await page.getByRole("button", { name: "Thêm 1 vào giỏ" }).click();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: /Giỏ món/ }).click();
  await page.getByText("Lẩu QR QA", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Tăng số lượng Lẩu QR QA" }).click();
  // This second draft uses the DEFAULT 250k size, not the earlier 370k large
  // variant. Quantity 2 must be 500k, never copy pricing from another line.
  await page.getByText("500.000đ").first().waitFor();
  assert.equal(await db.diningTicket.count({ where: { sessionId: session.id } }), 1,
    "restoring an unsent cart must never create a server ticket");
  for (const size of [320, 360, 390, 428, 768, 1280]) {
    await page.setViewportSize({ width: size, height: size === 320 ? 568 : 844 });
    await page.evaluate(() => new Promise(resolve =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      true, "Menu QR horizontal overflow at " + size);
    await page.screenshot({ path: "apps/menu/qa-artifacts/menu-" + size + ".png" });
  }
  // WAITER must NOT rotate QR (only OWNER/MANAGER). Verify deny before owner rotates.
  const rotatePath = api + "/dining/branches/" + branch.id + "/tables/" + table.id + "/rotate-qr";
  const denied = await fetch(rotatePath, {
    method: "POST", headers: { Authorization: "Bearer " + tokens.accessToken },
  });
  assert.equal(denied.status, 403, "waiter cannot revoke table QR");
  const owner = await db.user.create({ data: { role: "OWNER" } });
  const ownerName = "ownerqa" + unique.slice(0, 12);
  await db.localCredential.create({ data: { userId: owner.id,
    normalizedUsername: ownerName, verifiedEmail: ownerName + "@example.test",
    passwordHash: await hash(password) } });
  const ownerLogin = await fetch(api + "/auth/login", { method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: ownerName, password }),
  });
  assert.equal(ownerLogin.status, 201);
  const ownerTokens = await ownerLogin.json();
  // Closing/revoking an in-use QR immediately disables old grants and locator.
  const rotated = await fetch(rotatePath, {
    method: "POST", headers: { Authorization: "Bearer " + ownerTokens.accessToken },
  });
  assert.equal(rotated.status, 201);
  await page.getByRole("tab", { name: /Yêu cầu/ }).click();
  await page.getByRole("button", { name: "Cập nhật trạng thái" }).click();
  await page.getByText("Phiên bàn đã kết thúc").waitFor();
  await other.reload({ waitUntil: "domcontentloaded" });
  await other.getByText("Mã QR không hợp lệ").waitFor();
  assert.equal(await db.diningTicket.count({ where: { sessionId: session.id } }), 1);
  assert.deepEqual(errors, []);
  console.log("PASS L05 QR guest: unopened table, priced variant, pending-only kitchen, separate guests, staff review, grant renew, reload, QR revoke, 320–768 responsive");
} finally {
  await guestA.close(); await guestB.close(); await browser.close(); await db.$disconnect();
}
