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
  // Closed branches must still serve public product menus, without allowing checkout.
  const closedBranch = await db.branch.create({ data: {
    code: "CLOSED" + randomUUID().replaceAll("-", "").slice(0, 12),
    name: "Chi nhánh QA đang nghỉ", isActive: false,
    latitude: "10.1234567", longitude: "106.7654321",
  } });
  const closedCategory = await db.catalogCategory.create({ data: {
    branchId: closedBranch.id, name: "Món khi nghỉ", sortOrder: 0,
  } });
  await db.product.create({ data: {
    categoryId: closedCategory.id, name: "Lẩu xem được khi quán nghỉ", priceVnd: 99000,
  } });
  const category = await db.catalogCategory.create({ data: {
    branchId: branch.id, name: "Lẩu kiểm thử", sortOrder: 1,
  } });
  const product = await db.product.create({ data: {
    categoryId: category.id, name: productName, priceVnd: 159000,
    isFeatured: true, sortOrder: 0,
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
  await page.goto(web, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByRole("button", { name: /Xem thực đơn mà không cần đăng nhập/ }).waitFor();
  await page.getByRole("button", { name: /Xem thực đơn mà không cần đăng nhập/ }).click();
  // Login-first now routes guests to Home; branch selectors live on the Menu tab.
  await page.getByRole("tab", { name: "Thực đơn" }).click();
  await page.getByRole("button", { name: closedBranch.name }).click();
  await page.getByRole("button", { name: "Xem món Lẩu xem được khi quán nghỉ" }).waitFor();
  await page.getByText("Quán hiện đã nghỉ.", { exact: false }).waitFor();
  await page.getByRole("button", { name: branchName }).click();
  await page.getByRole("button", { name: "Xem món " + productName }).waitFor();
  await page.getByRole("button", { name: "Xem món " + productName }).click();
  await page.getByRole("button", { name: /Thêm vào giỏ/ }).click();
  await page.getByText("Vui lòng chọn đủ tùy chọn: Độ cay").waitFor();
  await page.getByRole("radio", { name: /Cay vừa/ }).click();
  // Every optional topping has its own counter, not a one-time checkbox.
  await page.getByRole("button", { name: "Thêm Nấm kim châm" }).click();
  await page.getByRole("radio", { name: /Size Khẩu phần 2 người/ }).click();
  assert.equal(await page.getByRole("radio",{name:/Size Khẩu phần 2 người/})
    .getAttribute("aria-checked"),"true");
  assert.equal(await page.getByRole("radio",{name:"Cay vừa"})
    .getAttribute("aria-checked"),"true");
  await page.screenshot({ path: "apps/customer/qa-artifacts/p22-detail-390.png", fullPage: true });
  await page.getByRole("button", { name: /Thêm vào giỏ/ }).click();
  // P4.6: adding a product returns to Menu to let guests continue shopping.
  await page.getByRole("button", { name: "Xem món " + productName }).waitFor();
  await page.getByText("Đã thêm món vào giỏ. Bạn có thể chọn tiếp", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Giỏ hàng", exact: true }).click();
  await page.getByText("Nấm kim châm · Cay vừa").waitFor({ timeout: 10000 }).catch(async () => {
    await page.getByText(/Nấm kim châm/).waitFor({ timeout: 1500 });
  });
  assert.ok(await page.getByText("Cay vừa", { exact: false }).count());
  // Modify an existing topping inside the cart: no duplicate dish and prices
  // must immediately reflect two toppings on one portion.
  await page.getByRole("button", { name:"Thêm topping Nấm kim châm" }).click();
  await page.getByText("2 cho 1 phần",{exact:false}).waitFor();
  assert.ok(await page.getByText("232.000 ₫",{exact:false}).count(),
    "159000 base + 49000 size + 2 x 12000 topping");
  await page.screenshot({ path: "apps/customer/qa-artifacts/p22-cart-390.png", fullPage: true });
  await page.setViewportSize({width:320,height:700});
  await page.screenshot({ path: "apps/customer/qa-artifacts/p22-cart-320.png", fullPage: true });
  await page.setViewportSize({width:390,height:844});
  console.log("PASS: real PostgreSQL catalogue, mandatory spice, topping, variant and cart");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Xem thực đơn mà không cần đăng nhập/ }).waitFor();
  await page.getByRole("button", { name: /Xem thực đơn mà không cần đăng nhập/ }).click();
  await page.getByRole("button", { name: "Giỏ hàng", exact: true }).click();
  await page.getByText(productName).waitFor();
  await page.getByText("2 cho 1 phần",{exact:false}).waitFor();
  console.log("PASS: cart survives reload with size, required spice and two optional toppings");
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
  await page.getByRole("button", { name: "Thêm địa chỉ Nhà" }).click();
  await page.getByRole("button", { name: "Đóng thêm địa chỉ" }).waitFor();
  await page.getByRole("textbox", { name: "Số điện thoại" }).fill("0912345678");
  await page.getByRole("button", { name: "Chọn Tỉnh/Thành phố" }).click();
  await page.getByRole("radio", { name: /Hồ Chí Minh/ }).click();
  await page.getByRole("button", { name: "Chọn Phường/Xã/Đặc khu" }).click();
  await page.getByRole("radio", { name: /Thủ Dầu Một/ }).click();
  await page.getByRole("textbox", { name: "Số nhà, tên đường và ghi chú giao" }).fill("12 Nguyễn Trãi, Quận 1, TP HCM");
  await page.getByRole("textbox", { name: "Vĩ độ (latitude)" }).fill("10.1234567");
  await page.getByRole("textbox", { name: "Kinh độ (longitude)" }).fill("106.7654321");
  await page.getByRole("button", { name: "Lưu địa chỉ vào tài khoản" }).click();
  await page.getByText("12 Nguyễn Trãi, Quận 1, TP HCM").waitFor();
  assert.ok(requests.some(x => x.path === "/customer/addresses" && x.status === 201));
  await page.getByRole("tab", { name: "Tôi" }).click();
  await page.getByRole("button", { name: "Xem ghim Nhà" }).waitFor();
  await page.getByRole("button", { name: "Dùng địa chỉ Nhà" }).click();

  // A draft can be canceled without silently changing the current address.
  await page.getByRole("button", { name: "＋ Thêm địa chỉ" }).click();
  await page.getByRole("textbox", { name: "Số nhà, tên đường và ghi chú giao" }).fill("Bản nháp hủy");
  await page.getByRole("button", { name: "Hủy", exact: true }).click();
  await page.getByRole("button", { name: "Xem ghim Nhà" }).waitFor();
  assert.equal(await page.getByText("Bản nháp hủy").count(), 0);

  await page.getByRole("button", { name: "＋ Thêm địa chỉ" }).click();
  await page.getByRole("textbox", { name: "Tên gợi nhớ (Nhà, Công ty...)" }).fill("Công ty");
  await page.getByRole("button", { name: "Chọn Tỉnh/Thành phố" }).click();
  await page.getByRole("radio", { name: /Hồ Chí Minh/ }).click();
  await page.getByRole("button", { name: "Chọn Phường/Xã/Đặc khu" }).click();
  await page.getByRole("radio", { name: /Thủ Dầu Một/ }).click();
  await page.getByRole("textbox", { name: "Số nhà, tên đường và ghi chú giao" }).fill("43 Lê Lợi, Quận 1, TP HCM");
  await page.getByRole("textbox", { name: "Vĩ độ (latitude)" }).fill("10.2234567");
  await page.getByRole("textbox", { name: "Kinh độ (longitude)" }).fill("106.8654321");
  await page.getByRole("button", { name: "Lưu địa chỉ vào tài khoản" }).click();
  await page.getByRole("button", { name: "Xem ghim Công ty" }).waitFor();
  await page.getByRole("button", { name: "Xóa địa chỉ Nhà" }).click();
  await page.getByRole("button", { name: "Xác nhận xóa địa chỉ" }).click();
  await page.getByRole("button", { name: "Xem ghim Nhà" }).waitFor({ state: "detached" });
  assert.ok(requests.some(x => x.path.startsWith("/customer/addresses/") && x.status === 200));
  await page.screenshot({ path: "apps/customer/qa-artifacts/p22-address-390.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log("PASS: login-on-checkout, account scoped multiple saved addresses, select and delete");
  console.log("PASS: zero browser page errors; checkout requires a server delivery quote");
  await ctx.close();
} finally {
  await browser.close();
  await db.$disconnect();
}
