import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");
const { hash } = require("@node-rs/argon2");
const expected = "postgresql://hotpot_ci:hotpot_ci_only@127.0.0.1:5432/hotpot_ci?schema=public";
if (process.env.GITHUB_ACTIONS !== "true" || process.env.DATABASE_URL !== expected)
  throw Error("L04 browser QA must use disposable localhost CI database");
const db = new PrismaClient();
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
mkdirSync("apps/retail/qa-artifacts", { recursive: true });
const api = "http://127.0.0.1:3001";
const web = "http://127.0.0.1:3004";
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", err => errors.push(err.message));
try {
  const id = randomUUID().replaceAll("-", "");
  const branch = await db.branch.create({ data: {
    name: "Retail QA " + id.slice(0, 8), code: "RETAIL" + id.slice(0, 10),
    latitude: "10.1234567", longitude: "106.7654321",
  } });
  const user = await db.user.create({ data: { role: "CUSTOMER" } });
  const username = "retail" + id.slice(0, 16);
  const password = "staff-pos-qa";
  await db.localCredential.create({ data: { userId: user.id, normalizedUsername: username,
    passwordHash: await hash(password), verifiedEmail: username + "@example.test" } });
  await db.branchMember.create({ data: { branchId: branch.id, userId: user.id, role: "WAITER" } });
  const area = await db.diningArea.create({ data: { branchId: branch.id, name: "Tầng 1" } });
  const table = await db.diningTable.create({ data: { branchId: branch.id, areaId: area.id,
    code: "A1", name: "Bàn A1", qrHandle: id } });
  const category = await db.catalogCategory.create({ data: { branchId: branch.id, name: "Lẩu",
    isPublished: true } });
  const product = await db.product.create({ data: { categoryId: category.id,
    name: "Lẩu Retail QA", priceVnd: 250_000, isAvailable: true } });
  // Product cards must form a real 3-column grid at 1280+, not just render
  // three empty placeholders in a screenshot.
  await db.product.createMany({ data: [
    { categoryId: category.id, name: "Bò sốt tiêu QA", priceVnd: 185_000, isAvailable: true },
    { categoryId: category.id, name: "Trà sữa QA", priceVnd: 35_000, isAvailable: true },
  ] });
  await page.goto(web, { waitUntil: "domcontentloaded" });
  await page.getByRole("textbox", { name: "Tài khoản nhân viên" }).fill(username);
  await page.getByRole("textbox", { name: "Mật khẩu" }).fill(password);
  page.on("response", response => {
    if (!response.ok() && ["/auth/", "/admin/", "/dining/"].some(prefix => new URL(response.url()).pathname.startsWith(prefix))) {
      console.log("L04_HTTP_ERROR", response.status(), new URL(response.url()).pathname);
    }
  });
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  try { await page.getByText("Bàn đang phục vụ").waitFor({ timeout: 12000 }); }
  catch (error) {
    console.log("L04_LOGIN_DIAGNOSTIC", (await page.locator("body").innerText()).slice(0, 1300));
    console.log("L04_PAGE_ERRORS", errors.slice(0, 8));
    await page.screenshot({ path: "apps/retail/qa-artifacts/login-diagnostic.png" });
    throw error;
  }
  await page.getByRole("button", { name: "Bàn A1, trống" }).click();
  await page.getByRole("button", { name: "Mở phiên bàn" }).click();
  await page.getByRole("button", { name: "Chọn Lẩu Retail QA" }).waitFor();
  await page.getByRole("button", { name: "Chọn Lẩu Retail QA" }).click();
  await page.getByRole("button", { name: "Thêm 1 vào hóa đơn" }).click();
  await page.getByText("1 món trong giỏ bàn").waitFor();
  await page.getByRole("button", { name: "Xem hóa đơn" }).click();
  await page.getByTestId("retail-bill-accepted").waitFor();
  await page.getByRole("tab", { name: "Hóa đơn (1)" }).waitFor();
  await page.getByRole("button", { name: "Xác nhận & gửi Bếp" }).click();
  await page.getByText("Đã gửi món xuống Bếp.").waitFor();
  const session = await db.diningSession.findFirstOrThrow({ where: {
    tableId: table.id, closedAt: null,
  } });
  assert.equal(await db.diningTicket.count({ where: { sessionId: session.id, source: "STAFF" } }), 1);
  const approved = await db.diningTicket.findFirstOrThrow({
    where: { sessionId: session.id, source: "STAFF" },
    include: { items: true },
  });
  assert.equal(approved.status, "APPROVED");
  assert.equal(approved.items[0].lineTotalVnd, 250_000);
  // Second real browser session sees the same table after 5-second polling / reload.
  const second = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const device = await second.newPage();
  await device.goto(web, { waitUntil: "domcontentloaded" });
  await device.getByRole("textbox", { name: "Tài khoản nhân viên" }).fill(username);
  await device.getByRole("textbox", { name: "Mật khẩu" }).fill(password);
  await device.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await device.getByRole("button", { name: "Bàn A1, đang có khách" }).waitFor();
  await device.getByRole("button", { name: "Bàn A1, đang có khách" }).click();
  await device.getByText("Lẩu Retail QA", { exact: false }).first().waitFor();
  await device.screenshot({ path: "apps/retail/qa-artifacts/pos-tablet-1024.png" });
  const grant = await fetch(api + "/dining/qr/" + table.qrHandle + "/grants", { method: "POST" });
  assert.equal(grant.status, 201);
  const grantData = await grant.json();
  const guest = await fetch(api + "/dining/guest/tickets", {
    method: "POST", headers: { Authorization: "Dining " + grantData.credential,
      "Content-Type": "application/json" },
    body: JSON.stringify({ idempotencyKey: "guest-" + randomUUID(), items: [{
      productId: product.id, variantId: null, modifierIds: [],
      comboOptionIds: [], quantity: 1,
    }] }),
  });
  assert.equal(guest.status, 201);
  const guestTicket = await guest.json();
  assert.equal(guestTicket.status, "PENDING_APPROVAL");
  // The QR request must stay PENDING until a staff member explicitly approves.
  assert.equal((await db.diningTicket.findUniqueOrThrow({
    where: { id: guestTicket.ticketId },
  })).status, "PENDING_APPROVAL");
  await device.getByRole("button", { name: "Duyệt QR (1)" }).waitFor({ timeout: 15000 });
  await device.getByRole("button", { name: "Duyệt QR (1)" }).click();
  await device.getByTestId("retail-qr-queue").waitFor();
  await device.getByRole("button", { name: "Xem phiếu QR Bàn A1" }).click();
  await device.getByText("Chi tiết Bàn A1").waitFor();
  await device.getByRole("button", { name: "Duyệt đưa Bếp" }).click();
  await device.getByText("Đã duyệt;", { exact: false }).waitFor();
  assert.equal((await db.diningTicket.findUniqueOrThrow({ where: { id: guestTicket.ticketId } })).status,
    "APPROVED");
  assert.equal(await db.diningTicket.count({ where: { sessionId: session.id } }), 2);
  await device.getByText("Không có yêu cầu chờ").waitFor({ timeout: 15000 });
  await device.getByRole("button", { name: "Bàn & Món" }).click();
  await device.getByTestId("retail-bill-accepted").getByText("Món đã xác nhận (2)").waitFor();
  assert.equal(await db.diningTicket.count({ where: { sessionId: session.id,
    status: "PENDING_APPROVAL" } }), 0, "no pending QR tickets after staff approval");
  for (const width of [320, 360, 390, 428, 768, 1024, 1280, 1440]) {
    await device.setViewportSize({ width, height: 820 });
    // React Native Web useWindowDimensions updates after browser resize;
    // wait for the *actual* responsive branch before judging real overflow.
    if (width < 768) {
      await device.getByRole("tab", { name: "Bàn", exact: true }).waitFor({ timeout: 7000 });
      await device.getByTestId("retail-desk-menu").waitFor({ state: "detached", timeout: 7000 });
    } else {
      await device.getByTestId("retail-desk-menu").waitFor({ timeout: 7000 });
    }
    await device.evaluate(() => new Promise(resolve =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const layout = await device.evaluate(() => {
      const extra = [...document.querySelectorAll("*")].map(node => {
        const r = node.getBoundingClientRect();
        return { tag: node.tagName, width: Math.round(r.width), x: Math.round(r.x),
          right: Math.round(r.right), cls: String(node.getAttribute("class") ?? "").slice(0, 75),
          text: (node.textContent ?? "").trim().slice(0, 45) };
      }).filter(n => n.right > innerWidth + 1 || n.x < -1)
        .sort((a, b) => b.right - a.right).slice(0, 7);
      return { viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, extra };
    });
    if (layout.scrollWidth > width + 1) console.log("L02_OVERFLOW_DIAGNOSTIC", width, JSON.stringify(layout));
    await device.screenshot({ path: "apps/retail/qa-artifacts/pos-" + width + ".png" });
    assert.equal(layout.scrollWidth <= width + 1, true, "Retail POS overflow at " + width);
    if (width >= 768) {
      const rail = await device.getByTestId("retail-table-strip").boundingBox();
      const order = await device.getByTestId("retail-desk-order").boundingBox();
      const menu = await device.getByTestId("retail-desk-menu").boundingBox();
      assert.ok(rail && order && menu, "desktop rail and split are visible at " + width);
      assert.ok(rail.height < 112, "table strip must not waste height at " + width + ": " + rail.height);
      assert.ok(menu.width / (menu.width + order.width) >= 0.57,
        "menu needs at least 57% of useful desktop width at " + width);
      assert.ok(menu.x > order.x + order.width - 1,
        "invoice and menu must not overlap at " + width);
    }
    if (width >= 1280) {
      const cards = await Promise.all(["Lẩu Retail QA", "Bò sốt tiêu QA", "Trà sữa QA"]
        .map(name => device.getByRole("button", { name: "Chọn " + name }).boundingBox()));
      assert.ok(cards.every(Boolean), "three real product cards displayed at " + width);
      assert.ok(cards.every(card => Math.abs(card.y - cards[0].y) < 2),
        "three product cards must share the first row at " + width);
      assert.ok(cards.every(card => card.width >= 120),
        "product cards must remain readable at " + width);
    }
    await device.screenshot({ path: "apps/retail/qa-artifacts/pos-" + width + ".png" });
  }
  assert.deepEqual(errors, []);
  await second.close();
  console.log("PASS L04 Retail real auth/branch, multi-device table session, idempotent staff ticket, QR review and responsive 360–1440");
} finally {
  await context.close();
  await browser.close();
  await db.$disconnect();
}
