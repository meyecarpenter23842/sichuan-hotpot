import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const web = "http://127.0.0.1:3000";
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const directory = "apps/customer/qa-artifacts";
mkdirSync(directory, { recursive: true });

try {
  for (const [width, height] of [[320, 640], [360, 740], [390, 844], [428, 926], [768, 1024]]) {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(web, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Xem thực đơn mà không cần đăng nhập/ }).click();
    // P22 seeded this exact product into disposable CI PostgreSQL. Select its
    // branch so homepage screenshots exercise the real carousel, not only empty state.
    await page.getByRole("tab", { name: "Thực đơn" }).click();
    await page.getByRole("button", { name: /^P22 QA / }).first().click();
    await page.getByRole("button", { name: "Xem món Lẩu QA vị Tứ Xuyên" }).waitFor();
    await page.getByRole("tab", { name: "Trang chủ" }).click();
    await page.getByRole("tab", { name: "Trang chủ" }).waitFor();
    await page.getByTestId("home-feature-carousel").waitFor();
    const homeHeroImage = page.getByTestId("home-approved-hero").locator("img").first();
    await homeHeroImage.waitFor();
    assert.equal(await homeHeroImage.evaluate(img => img.complete && img.naturalWidth > 0), true,
      "Approved Home hero artwork failed to render at " + width);
    assert.equal(await page.getByRole("textbox", { name: "Tìm món ăn, trà sữa" }).count(), 0,
      "Owner removed home search; it must remain only in menu");
    for (const [label, icon] of [
      ["Lẩu", "hotpot"], ["Trà sữa", "milkTea"], ["Combo", "combo"],
      ["Topping", "topping"], ["Ưu đãi", "offers"],
    ]) {
      const button = page.getByRole("button", { name: "Xem danh mục " + label, exact: true });
      await button.waitFor();
      const rect = await button.boundingBox();
      assert.ok(rect && rect.x >= -1 && rect.x + rect.width <= width + 1,
        "Category clipped: " + label + " at " + width);
      const image = page.getByTestId("home-category-icon-" + icon).first().locator("img");
      await image.waitFor();
      assert.equal(await image.evaluate(img => img.complete && img.naturalWidth > 0), true,
        "Category artwork failed to load: " + label);
    }
    const nav = page.getByRole("tab", { name: "Trang chủ" });
    const before = await nav.boundingBox();
    assert.ok(before && Math.abs(before.y + before.height - height) <= 5,
      "Bottom nav not fixed at viewport bottom: " + width + "x" + height);
    await page.mouse.wheel(0, 900);
    const after = await nav.boundingBox();
    assert.ok(after && Math.abs(before.y - after.y) <= 1, "Bottom nav moves during scroll");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      true, "horizontal overflow at " + width);
    assert.deepEqual(errors, [], "browser errors at " + width);
    await page.screenshot({ path: directory + "/p24-home-" + width + "x" + height + ".png" });
    await page.getByRole("button", { name: "Chọn tùy chọn Lẩu QA vị Tứ Xuyên" }).click();
    await page.getByText("Khẩu phần / kích cỡ").waitFor();
    await page.getByRole("tab", { name: "Trang chủ" }).click();
    await page.getByRole("button", { name: "Xem danh mục Trà sữa" }).click();
    await page.getByRole("tab", { name: "Thực đơn" }).waitFor();
    await page.getByRole("textbox", { name: "Tìm món ăn, trà sữa" }).waitFor();
    await ctx.close();
    console.log("PASS: Home reference categories, fixed tabs, menu search and artwork", width, height);
  }
} finally {
  await browser.close();
}
