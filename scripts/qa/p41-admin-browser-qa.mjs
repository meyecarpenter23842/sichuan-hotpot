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
  const customer = await db.user.create({ data: { role: "CUSTOMER" } });
  const policy = await db.deliveryPolicyVersion.create({ data: {
    branchId: branch.id, version: 1, acceptingOrders: true, baseMeters: 2000,
    baseFeeVnd: 10000, extraStepMeters: 1000, extraStepFeeVnd: 5000,
    maxRoadMeters: 12000, minSubtotalVnd: 50000,
  } });
  const operationalOrder = await db.order.create({ data: {
    branchId: branch.id, customerId: customer.id, deliveryPolicyVersionId: policy.id,
    idempotencyKey: randomUUID(), status: "PENDING", subtotalVnd: 120000,
    deliveryFeeVnd: 10000, totalVnd: 130000, roadDistanceMeters: 1700,
    addressLineSnapshot: "Địa chỉ thử nghiệm",
    latitudeSnapshot: "10.7731000", longitudeSnapshot: "106.7032000",
    items: { create: [{ productName: "Lẩu phiếu bếp", quantity: 2,
      unitPriceVnd: 60000, lineTotalVnd: 120000 }] },
  } });

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  // Verify PWA width lock without interfering with single-touch scrolling.
  await page.goto(web, { waitUntil: "domcontentloaded" });
  const vp = await page.locator('meta[name="viewport"]').getAttribute("content");
  assert.match(vp ?? "", /maximum-scale=1/);
  assert.match(vp ?? "", /user-scalable=no/);
  assert.equal(await page.evaluate(() =>
    getComputedStyle(document.documentElement).touchAction), "pan-x pan-y");
  await page.getByRole("textbox", { name: "Tên đăng nhập" }).fill(username);
  await page.getByRole("textbox", { name: "Mật khẩu" }).fill(password);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.getByText("Chi nhánh QA Admin").waitFor();
  // End-to-end operational flow using an actual order in disposable PostgreSQL.
  const shortId = operationalOrder.id.slice(0, 8);
  await page.getByRole("tab", { name: "Đơn hàng" }).click();
  await page.getByRole("button", { name: "Xem đơn " + shortId }).click();
  await page.getByRole("button", { name: "Xác nhận đơn" }).click();
  await page.getByRole("button", { name: "Xác nhận cập nhật" }).click();
  // A state mutation is complete only after the server replies and the modal closes.
  await page.getByRole("button", { name: "Đóng chi tiết đơn" }).waitFor({ state: "hidden" });
  await page.getByRole("tab", { name: "Bếp" }).click();
  await page.getByRole("button", { name: "Xem đơn " + shortId }).click();
  await page.getByRole("button", { name: "Bắt đầu chế biến" }).click();
  await page.getByRole("button", { name: "Xác nhận cập nhật" }).click();
  // A state mutation is complete only after the server replies and the modal closes.
  await page.getByRole("button", { name: "Đóng chi tiết đơn" }).waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Xem đơn " + shortId }).click();
  await page.getByRole("button", { name: "Báo món đã sẵn sàng" }).click();
  await page.getByRole("button", { name: "Xác nhận cập nhật" }).click();
  // A state mutation is complete only after the server replies and the modal closes.
  await page.getByRole("button", { name: "Đóng chi tiết đơn" }).waitFor({ state: "hidden" });
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: operationalOrder.id } })).status, "READY");
  assert.equal(await db.orderStatusHistory.count({ where: { orderId: operationalOrder.id } }), 3);
  console.log("PASS P4: Admin accepts an order, kitchen prepares, then marks ready in real DB");

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
  const productSwitch = page.getByRole("switch", { name: "Bán món Lẩu QA P4.1" });
  await productSwitch.waitFor();
  const savedProduct = await db.product.findFirstOrThrow({
    where: { name: "Lẩu QA P4.1", category: { branchId: branch.id } },
  });
  assert.equal(savedProduct.isAvailable, true, "Product must be available when created");
  assert.equal(await productSwitch.getAttribute("aria-checked"), "true",
    "Switch ARIA state must match real product availability");
  assert.equal(await productSwitch.isChecked(), true);
  await productSwitch.click();
  await page.waitForFunction(() => {
    const el = document.querySelector('[role="switch"][aria-label="Bán món Lẩu QA P4.1"]');
    return el instanceof HTMLInputElement ? !el.checked : el?.getAttribute("aria-checked") === "false";
  });
  await productSwitch.click();
  await page.waitForFunction(() => {
    const el = document.querySelector('[role="switch"][aria-label="Bán món Lẩu QA P4.1"]');
    return el instanceof HTMLInputElement ? el.checked : el?.getAttribute("aria-checked") === "true";
  });

  await page.getByRole("button", { name: "Xem chi tiết Lẩu QA P4.1" }).click();
  await page.getByRole("button", { name: "＋ Size" }).click();
  await page.getByRole("textbox", { name: "Tên", exact: true }).fill("Phần hai người");
  await page.getByRole("textbox", { name: "Phụ thu (VND)" }).fill("49000");
  await page.getByRole("button", { name: "Lưu thay đổi" }).click();
  await page.getByRole("button", { name: "Xem chi tiết Lẩu QA P4.1" }).click();
  await page.getByText("Phần hai người", { exact: false }).waitFor();

  // L03: create one reusable library group and attach it to an existing product.
  await page.getByRole("button", { name: "Đóng chi tiết món" }).click();
  await page.getByRole("tab", { name: "Nhóm tùy chọn" }).click();
  await page.getByRole("button", { name: "＋ Nhóm" }).click();
  await page.getByRole("textbox", { name: "Tên hiển thị" }).fill("Độ cay");
  await page.getByRole("textbox", { name: "Chọn tối thiểu" }).fill("1");
  await page.getByRole("textbox", { name: "Chọn tối đa" }).fill("1");
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await page.getByRole("button", { name: "Đóng chỉnh sửa topping" }).waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Mở nhóm Độ cay" }).click();
  await page.getByRole("button", { name: "＋ Topping" }).click();
  await page.getByRole("textbox", { name: "Tên hiển thị" }).fill("Cay vừa");
  await page.getByRole("textbox", { name: "Giá topping (VND)" }).fill("5000");
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await page.getByRole("button", { name: "Đóng chỉnh sửa topping" }).waitFor({ state: "hidden" });
  const savedGroup = await db.modifierGroup.findFirstOrThrow({
    where: { name: "Độ cay", branchId: branch.id },
  });
  const savedOption = await db.modifierOption.findFirstOrThrow({
    where: { name: "Cay vừa", groupId: savedGroup.id },
  });
  assert.equal(savedGroup.isAvailable, false, "Unpictured new group starts as a draft");
  assert.equal(savedOption.isAvailable, false, "Unpictured new option starts as a draft");
  await page.getByRole("button", { name: "Gắn nhóm cho Lẩu QA P4.1" }).click();
  await page.getByRole("checkbox", { name: /Độ cay/ }).click();
  await page.getByRole("button", { name: "Lưu nhóm gắn" }).click();
  await page.getByRole("button", { name: "Đóng chọn nhóm" }).waitFor({ state: "hidden" });
  assert.equal(await db.productModifierGroupAssignment.count({
    where: { productId: savedProduct.id, groupId: savedGroup.id },
  }), 1);

  // Fixture: previously verified image keys on disposable PostgreSQL ONLY. Actual
  // R2 ticket + HEAD checks are covered by the API service, not this browser fixture.
  await db.modifierGroup.update({ where: { id: savedGroup.id }, data: {
    imageKey: "catalog-media/" + branch.id + "/groups/" + savedGroup.id + "/verified.png",
    isAvailable: true,
  } });
  await db.modifierOption.update({ where: { id: savedOption.id }, data: {
    imageKey: "catalog-media/" + branch.id + "/options/" + savedOption.id + "/verified.png",
    isAvailable: true,
  } });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "Thực đơn" }).click();
  await page.getByRole("tab", { name: "Nhóm tùy chọn" }).click();
  await page.getByRole("button", { name: "Mở nhóm Độ cay" }).click();
  const optionSwitch = page.getByRole("switch", { name: "Bán topping Cay vừa" });
  const rejected = page.waitForResponse(response => response.url().includes(
    "/library/options/" + savedOption.id) && response.request().method() === "PATCH");
  await optionSwitch.click();
  assert.equal((await rejected).status(), 409,
    "Disabling the only required topping must be rejected by the backend");
  assert.equal((await db.modifierOption.findUniqueOrThrow({ where: {
    id: savedOption.id,
  } })).isAvailable, true, "Required topping cannot be disabled");

  await page.getByRole("button", { name: "Sửa nhóm Độ cay" }).click();
  await page.getByRole("textbox", { name: "Chọn tối thiểu" }).fill("0");
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await page.getByRole("button", { name: "Đóng chỉnh sửa topping" }).waitFor({ state: "hidden" });
  await optionSwitch.click();
  await page.waitForFunction(() =>
    document.querySelector('[role="switch"][aria-label="Bán topping Cay vừa"]')
      ?.getAttribute("aria-checked") === "false");
  assert.equal((await db.modifierOption.findUniqueOrThrow({ where: {
    id: savedOption.id,
  } })).isAvailable, false);
  await optionSwitch.click();
  await page.waitForFunction(() =>
    document.querySelector('[role="switch"][aria-label="Bán topping Cay vừa"]')
      ?.getAttribute("aria-checked") === "true");
  console.log("PASS L03: shared group, draft images, product attachment and option switch");

  await page.getByRole("button", { name: "Mở thiết lập" }).click();
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
 
  // L08: use a real persisted featured product in all three screenshot tabs.
  await page.getByRole("tab", { name: "Thực đơn" }).click();
  await page.getByRole("tab", { name: "Món gợi ý" }).click();
  await page.getByRole("button", { name: "＋ Gợi ý" }).click();
  await page.getByRole("switch", { name: "Gợi ý món Lẩu QA P4.1" }).click();
  await page.getByRole("button", { name: "Lưu món gợi ý" }).click();
  await page.getByRole("button", { name: "Xem chi tiết Lẩu QA P4.1" }).waitFor();
  assert.equal((await db.product.findUniqueOrThrow({
    where: { id: savedProduct.id },
  })).isFeatured, true, "L08 screenshots require a saved featured product");

  for (const width of [320, 360, 390, 428]) {
    await page.setViewportSize({ width, height: 844 });
    for (const tab of ["Tổng quan", "Thực đơn", "Thiết lập"]) {
      if (tab === "Thiết lập") await page.getByRole("button", { name: "Mở thiết lập" }).click();
      else await page.getByRole("tab", { name: tab }).click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        true, "Admin horizontal overflow in " + tab + " at " + width);
      if (tab === "Thiết lập") {
        await page.getByRole("button", { name: "Mở Giờ bán" }).waitFor();
      } else {
        await page.getByText(tab === "Tổng quan" ? "Đơn mới cần xác nhận" : "Tìm món").first().waitFor();
      }
      // Screen density is a visual/layout contract, not just a responsive
      // overflow check. Size relative to CSS pixels; safe-area is OS-managed.
      const nav = await page.getByRole("tab", { name: "Tổng quan" }).boundingBox();
      const branchSwitch = await page.getByRole("button", { name: "Đổi chi nhánh" }).boundingBox();
      assert.ok(nav && nav.height >= 44 && nav.height <= 52,
        "Bottom navigation must stay compact and accessible at " + width);
      assert.ok(branchSwitch && branchSwitch.height <= 56 && branchSwitch.height >= 44,
        "Branch selector should not be oversized at " + width);
      if (tab === "Tổng quan") {
        const metric = await page.getByRole("button", { name: /^Đơn mới:/ }).boundingBox();
        assert.ok(metric && metric.height <= 80 && metric.height >= 44,
          "Dashboard KPI card is too tall at " + width);
        // The branch dropdown is a layer, never another flex child of the header.
        const kpiY = metric.y;
        await page.getByRole("button", { name: "Đổi chi nhánh" }).click();
        await page.getByRole("button", { name: /^Chọn chi nhánh / }).first().waitFor();
        const overlayKpi = await page.getByRole("button", { name: /^Đơn mới:/ }).boundingBox();
        assert.ok(overlayKpi && Math.abs(overlayKpi.y - kpiY) <= 1,
          "Opening branch dropdown must not push content down at " + width);
        const backdrop = page.getByRole("button", { name: "Đóng danh sách chi nhánh" });
        await backdrop.click({ position: { x: width - 18, y: 260 } });
        await page.getByRole("button", { name: /^Chọn chi nhánh / }).first().waitFor({ state: "hidden" });
      }
      if (tab === "Thiết lập") {
        const tile = await page.getByRole("button", { name: "Mở Thông báo" }).boundingBox();
        assert.ok(tile && tile.height <= 116 && tile.height >= 44,
          "Settings shortcut tile is too tall at " + width);
      }
      if (tab === "Thực đơn") {
        const tabs = page.getByRole("tablist");
        const y1 = (await tabs.boundingBox())?.y;
        await page.getByRole("tab", { name: "Nhóm tùy chọn" }).click();
        const y2 = (await tabs.boundingBox())?.y;
        assert.ok(y1 !== undefined && y2 !== undefined && Math.abs(y1 - y2) <= 1,
          "Switching menu sub-tabs must not move the tab bar at " + width);
        const contentScroll = page.getByTestId("catalog-body-scroll");
        assert.equal(await contentScroll.evaluate(el => el.contains(document.querySelector('[role="tablist"]'))),
          false, "Subtabs must be outside the scrollable list");
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          true, "L05 modifier list overflow at " + width);
        await page.screenshot({ path: "apps/admin/qa-artifacts/p45-l05-modifiers-" + width + ".png" });
        await page.screenshot({ path: "apps/admin/qa-artifacts/l08-modifiers-" + width + ".png" });
        await tabs.getByRole("tab", { name: "Món gợi ý" }).click();
        await page.getByRole("button", { name: "Xem chi tiết Lẩu QA P4.1" }).waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          true, "L08 featured tab overflow at " + width);
        await page.screenshot({ path: "apps/admin/qa-artifacts/l08-featured-" + width + ".png" });
        await tabs.getByRole("tab", { name: "Món", exact: true }).click();
        await page.screenshot({ path: "apps/admin/qa-artifacts/l08-products-" + width + ".png" });
      }
      await page.screenshot({ path: "apps/admin/qa-artifacts/p41-" +
        tab.replace(/\s/g, "-") + "-" + width + ".png" });
    }
    const headings = await page.locator("h1, h2").count();
    assert.equal(headings, 0, "Admin uses compact RN typography, not browser default headings");
  }
  // L08 tablet/desktop matrix; all screenshots come from the real CI API and DB.
  // Browser screenshots are evidence of layout only, never visual reference approval.
  for (const width of [768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole("tab", { name: "Thực đơn" }).click();
    const menuTabs = page.getByRole("tablist");
    const tabY = (await menuTabs.boundingBox())?.y;
    for (const [tab, slug] of [["Món", "products"], ["Nhóm tùy chọn", "modifiers"], ["Món gợi ý", "featured"]]) {
      await menuTabs.getByRole("tab", { name: tab, exact: true }).click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        true, "L08 admin horizontal overflow in " + tab + " at " + width);
      const nextTabY = (await menuTabs.boundingBox())?.y;
      assert.ok(tabY !== undefined && nextTabY !== undefined && Math.abs(tabY - nextTabY) <= 1,
        "L08 sub-tabs must not jump on " + width + " / " + tab);
      await page.screenshot({ path: "apps/admin/qa-artifacts/l08-" + slug + "-" + width + ".png" });
    }
  }
  assert.deepEqual(errors, []);
  console.log("PASS L08: three real Admin menu tabs at 320/360/390/428/768/1280/1440, 21 screenshots");
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

  // L08: a valid manager branch and valid foreign UUID must never allow
  // cross-branch product/variant/group/option writes or category reassignment.
  const foreignCategory = await db.catalogCategory.create({
    data: { branchId: otherBranch.id, name: "Foreign branch menu" },
  });
  const foreignProduct = await db.product.create({
    data: { categoryId: foreignCategory.id, name: "Foreign product", priceVnd: 57000 },
  });
  const foreignVariant = await db.productVariant.create({
    data: { productId: foreignProduct.id, name: "Foreign size", priceDeltaVnd: 12000 },
  });
  const foreignGroup = await db.modifierGroup.create({
    data: { productId: foreignProduct.id, name: "Foreign toppings", minSelect: 0, maxSelect: 1 },
  });
  const foreignOption = await db.modifierOption.create({
    data: { groupId: foreignGroup.id, name: "Foreign chili", priceDeltaVnd: 3000 },
  });
  const baseCatalog = api + "/admin/branches/" + branch.id + "/catalog";
  async function scopedWrite(path, method, data, expected) {
    const response = await fetch(baseCatalog + path, {
      method, headers: { ...managerHeaders, "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    assert.equal(response.status, expected, method + " " + path +
      " must return " + expected + ", got " + response.status);
  }
  await scopedWrite("/products", "POST", {
    categoryId: foreignCategory.id, name: "Cross-branch injection",
    priceVnd: 24000, isAvailable: true,
  }, 404);
  await scopedWrite("/products/" + foreignProduct.id, "PATCH", { priceVnd: 1 }, 404);
  await scopedWrite("/categories/" + foreignCategory.id, "PATCH", { name: "Tampered" }, 404);
  await scopedWrite("/variants/" + foreignVariant.id, "PATCH", { priceDeltaVnd: 1 }, 404);
  await scopedWrite("/groups/" + foreignGroup.id, "PATCH", { minSelect: 1 }, 404);
  await scopedWrite("/options/" + foreignOption.id, "PATCH", { isAvailable: false }, 404);
  await scopedWrite("/products/" + savedProduct.id, "PATCH",
    { categoryId: foreignCategory.id }, 404);
  await scopedWrite("/products/" + savedProduct.id, "PATCH",
    { priceVnd: 1.5 }, 400);
  await scopedWrite("/products/" + savedProduct.id, "PATCH",
    { name: "<script>" + "X".repeat(210) + "</script>" }, 400);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: foreignProduct.id } })).priceVnd, 57000);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: savedProduct.id } })).categoryId,
    savedProduct.categoryId);
  assert.equal((await db.modifierOption.findUniqueOrThrow({
    where: { id: foreignOption.id },
  })).isAvailable, true);
  assert.equal(await db.product.count({ where: { name: "Cross-branch injection" } }), 0);
  const customerWithoutAdmin = await fetch(baseCatalog, {
    headers: { Authorization: "Bearer broken-token" },
  });
  assert.equal(customerWithoutAdmin.status, 401);
  console.log("PASS L08: manager foreign UUID isolation, invalid price/name, denied auth; original DB rows unchanged");

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
  // Role is now shown on the dedicated Account screen, not the redesigned hero.
  await ownerPage.getByRole("button", { name: "Mở tài khoản" }).click();
  await ownerPage.getByText("Chủ cửa hàng", { exact: true }).waitFor();
  await ownerPage.getByRole("tab", { name: "Tổng quan" }).click();
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
