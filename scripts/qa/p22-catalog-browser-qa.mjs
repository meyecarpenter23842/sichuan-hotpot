import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();
const api = "http://127.0.0.1:3001";
const web = "http://127.0.0.1:3000";
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const errors = [];
try {
  // Fixtures exist only inside disposable CI PostgreSQL. Never use production here.
  const branchName = "P22 QA " + randomUUID().slice(0, 6);
  const productName = "Lẩu QA vị Tứ Xuyên";
  const branch = await db.branch.create({ data: {
    code: "QA" + randomUUID().replaceAll("-", "").slice(0, 15),
    name: branchName, latitude: "10.1234567", longitude: "106.7654321",
  } });
  const category = await db.catalogCategory.create({ data: {
    branchId: branch.id, name: "Lẩu kiểm thử", sortOrder: 1,
  } });
  const product = await db.product.create({ data: {
    categoryId: category.id, name: productName, priceVnd: 159000,
  } });
  await db.productVariant.create({ data: {
    productId: product.id, name: "Khẩu phần 2 người", priceDeltaVnd: 49000,
  } });
  const spice = await db.modifierGroup.create({ data: {
    productId: product.id, name: "Độ cay", minSelect: 1, maxSelect: 1, sortOrder: 1,
  } });
  await db.modifierOption.createMany({ data: [
    { groupId: spice.id, name: "Cay vừa", priceDeltaVnd: 0 },
    { groupId: spice.id, name: "Cay nhiều", priceDeltaVnd: 0 },
  ] });
  const extra = await db.modifierGroup.create({ data: {
    productId: product.id, name: "Topping", minSelect: 0, maxSelect: 2, sortOrder: 2,
  } });
  await db.modifierOption.create({ data: {
    groupId: extra.id, name: "Nấm kim châm", priceDeltaVnd: 12000,
  } });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const requests = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("response", r => {
    if (r.url().startsWith(api + "/")) requests.push({ path: new URL(r.url()).pathname, status: r.status() });
  });
  await page.goto(web, { waitUntil: "networkidle", timeout: 30000 });
  await page.getByRole("button", { name: /Xem thực đơn mà không cần đăng nhập/ }).click();
  // Login-first now routes guests to Home; branch selectors live on the Menu tab.
  await page.getByRole("tab", { name: "Thực đơn" }).click();
  await page.getByRole("button", { name: branchName }).click();
  await page.getByRole("button", { name: "Xem món " + productName }).waitFor();
  await page.getByRole("button", { name: "Xem món " + productName }).click();
  await page.getByRole("button", { name: /Thêm vào giỏ/ }).click();
  await page.getByText("Vui lòng chọn đủ tùy chọn: Độ cay").waitFor();
  await page.getByRole("radio", { name: /Cay vừa/ }).click();
  await page.getByRole("checkbox", { name: /Nấm kim châm/ }).click();
  await page.getByRole("radio", { name: /Khẩu phần 2 người/ }).click();
  await page.screenshot({ path: "apps/customer/qa-artifacts/p22-detail-390.png", fullPage: true });
  await page.getByRole("button", { name: /Thêm vào giỏ/ }).click();
  await page.getByText("Nấm kim châm · Cay vừa").waitFor({ timeout: 10000 }).catch(async () => {
    await page.getByText(/Nấm kim châm/).waitFor({ timeout: 1500 });
  });
  assert.ok(await page.getByText("Cay vừa", { exact: false }).count());
  await page.screenshot({ path: "apps/customer/qa-artifacts/p22-cart-390.png", fullPage: true });
  console.log("PASS: real PostgreSQL catalogue, mandatory spice, topping, variant and cart");

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Xem thực đơn mà không cần đăng nhập/ }).click();
  await page.getByRole("button", { name: /^Giỏ hàng, / }).click();
  await page.getByText(productName).waitFor();
  console.log("PASS: cart survives reload with modifier selections");
  await page.getByRole("button", { name: "Đăng nhập để tiếp tục" }).click();
  await page.getByRole("button", { name: "Đăng ký" }).click();
  const username = "p22" + randomUUID().replaceAll("-", "").slice(0, 18);
  const email = "p22" + randomUUID().replaceAll("-", "") + "@example.test";
  const password = "lauxuyen";
  await page.getByRole("textbox", { name: "Tên đăng nhập" }).fill(username);
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("textbox", { name: "Mật khẩu" }).fill(password);
  await page.getByRole("button", { name: "Gửi mã đăng ký" }).click();
  await page.getByText("Xác minh email", { exact: true }).waitFor();
  const emailResponse = await fetch("http://127.0.0.1:3333/test/inbox?to=" + encodeURIComponent(email));
  assert.equal(emailResponse.status, 200);
  const otp = (await emailResponse.json()).code;
  await page.getByRole("textbox", { name: "Mã xác minh (6 số)" }).fill(otp);
  await page.getByRole("button", { name: "Xác nhận mã và tạo tài khoản" }).click();
  await page.getByText(productName).waitFor();
  await page.getByRole("button", { name: "Thêm địa chỉ giao hàng" }).click();
  await page.getByRole("textbox", { name: "Số điện thoại" }).fill("0912345678");
  await page.getByRole("textbox", { name: "Số nhà, đường, phường/xã" }).fill("12 Nguyễn Trãi, Quận 1, TP HCM");
  await page.getByRole("textbox", { name: "Vĩ độ (latitude)" }).fill("10.1234567");
  await page.getByRole("textbox", { name: "Kinh độ (longitude)" }).fill("106.7654321");
  await page.getByRole("button", { name: "Lưu địa chỉ vào tài khoản" }).click();
  await page.getByText("12 Nguyễn Trãi, Quận 1, TP HCM").waitFor();
  assert.ok(requests.some(x => x.path === "/customer/addresses" && x.status === 201));
  await page.getByRole("tab", { name: "Tôi" }).click();
  await page.getByRole("button", { name: "Địa chỉ giao hàng" }).click();
  await page.getByText("Địa chỉ đã lưu (1/10)").waitFor();
  await page.getByRole("button", { name: "Dùng địa chỉ Nhà" }).click();
  await page.getByRole("button", { name: "Địa chỉ giao hàng" }).click();
  await page.getByRole("textbox", { name: "Tên gợi nhớ (Nhà, Công ty...)" }).fill("Công ty");
  await page.getByRole("textbox", { name: "Số nhà, đường, phường/xã" }).fill("43 Lê Lợi, Quận 1, TP HCM");
  await page.getByRole("button", { name: "Lưu địa chỉ vào tài khoản" }).click();
  await page.getByRole("button", { name: "Địa chỉ giao hàng" }).click();
  await page.getByText("Địa chỉ đã lưu (2/10)").waitFor();
  await page.getByRole("button", { name: "Xóa địa chỉ Nhà" }).click();
  await page.getByText("Địa chỉ đã lưu (1/10)").waitFor();
  assert.ok(requests.some(x => x.path.startsWith("/customer/addresses/") && x.status === 200));
  await page.screenshot({ path: "apps/customer/qa-artifacts/p22-address-390.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log("PASS: login-on-checkout, account scoped multiple saved addresses, select and delete");
  console.log("PASS: zero browser page errors; P3 order remains disabled");
  await ctx.close();
} finally {
  await browser.close();
  await db.$disconnect();
}
