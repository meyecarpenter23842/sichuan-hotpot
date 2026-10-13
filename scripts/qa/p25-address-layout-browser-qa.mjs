import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const directory = "apps/customer/qa-artifacts";
mkdirSync(directory, { recursive: true });

try {
  for (const width of [320, 360, 390, 428]) {
    const ctx = await browser.newContext({ viewport: { width, height: 844 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("http://127.0.0.1:3000", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Xem thực đơn mà không cần đăng nhập/ }).click();
    await page.getByRole("button", { name: /Giao đến/ }).click();
    await page.getByTestId("saved-address-page").waitFor();
    await page.getByText("Địa điểm đã lưu").waitFor();
    await page.getByRole("button", { name: "Thêm địa chỉ Nhà" }).waitFor();
    await page.getByRole("button", { name: "Thêm địa chỉ Công ty" }).waitFor();
    await page.getByRole("button", { name: "＋ Thêm địa chỉ mới" }).waitFor();
    assert.equal(await page.getByRole("tab", { name: "Trang chủ" }).count(), 0,
      "Full-screen address page should not show bottom tabs");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      true, "Address screen horizontal overflow at " + width);
    await page.screenshot({ path: directory + "/p25-address-empty-" + width + ".png" });

    await page.getByRole("button", { name: "Thêm địa chỉ Công ty" }).click();
    await page.getByRole("textbox", { name: "Tên gợi nhớ (Nhà, Công ty...)" }).waitFor();
    assert.equal(await page.getByRole("textbox",
      { name: "Tên gợi nhớ (Nhà, Công ty...)" }).inputValue(), "Công ty");
    await page.getByRole("button", { name: "Hủy", exact: true }).click();
    await page.getByRole("button", { name: "Quay lại từ địa chỉ đã lưu" }).click();
    await page.getByRole("tab", { name: "Trang chủ" }).waitFor();
    assert.deepEqual(errors, [], "Page errors at " + width);
    await ctx.close();
    console.log("PASS: saved places layout, office preset, modal cancellation, back navigation", width);
  }
} finally {
  await browser.close();
}
