import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

/**
 * Disposable CI browser QA: actual Expo Web bundle + real NestJS API +
 * isolated PostgreSQL service. No mocks, production access or real Google login.
 * Run only with a short-lived CI database / API. Never point this at production.
 */
const web = "http://127.0.0.1:3000";
const api = "http://127.0.0.1:3001";
const evidence = "apps/customer/qa-artifacts";
mkdirSync(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const failures = [];
try {
  const allowed = await fetch(api + "/auth/login", {
    method: "OPTIONS",
    headers: { Origin: web, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" },
  });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("access-control-allow-origin"), web);
  const denied = await fetch(api + "/auth/login", {
    method: "OPTIONS",
    headers: { Origin: "https://malicious.example.test", "Access-Control-Request-Method": "POST" },
  });
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
  console.log("PASS: CORS preflight exact origin allowed; unlisted origin excluded");

  for (const width of [320, 360, 390, 428, 768]) {
    const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("pageerror", error => failures.push(width + ": " + error.message));
    await page.goto(web, { waitUntil: "networkidle", timeout: 25000 });
    await page.getByRole("tab", { name: "Tài khoản" }).click();
    await page.getByRole("button", { name: "Đăng nhập / Tạo tài khoản" }).click();
    await page.getByText("Chào mừng trở lại!").waitFor();
    await page.waitForFunction(() => Array.from(document.querySelectorAll("img")).some(
      el => el.src.includes("/system-image/login-hero.png") && el.complete && el.naturalWidth > 0,
    ), { timeout: 10000 });
    const dimensions = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      hero: Array.from(document.querySelectorAll("img")).filter(x => x.src.includes("login-hero.png"))
        .map(x => ({ naturalWidth: x.naturalWidth, naturalHeight: x.naturalHeight })),
    }));
    assert.ok(dimensions.document <= dimensions.viewport + 1, "horizontal overflow at " + width);
    assert.equal(dimensions.hero[0]?.naturalWidth, 1448, "unexpected/missing R2 hero");
    assert.equal(dimensions.hero[0]?.naturalHeight, 1086);
    const google = page.getByRole("button", { name: "Tiếp tục với Google" });
    assert.equal(await google.isDisabled(), true, "CI must not fake a configured Google OAuth client");
    await page.screenshot({ path: evidence + "/login-" + width + ".png", fullPage: true });
    await page.getByRole("button", { name: "Đăng ký" }).click();
    await page.getByText("Tạo tài khoản mới").waitFor();
    await page.getByRole("button", { name: "Tạo tài khoản", exact: true }).click();
    await page.getByText(/Tên đăng nhập: 3–32 ký tự/).waitFor();
    assert.equal(await page.getByRole("button", { name: /Xem thực đơn mà không cần đăng nhập/ }).isVisible(), true);
    await ctx.close();
    console.log("PASS: " + width + "px hero, layout, signup validation, guest browse, no fake Google");
  }

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on("pageerror", error => failures.push("auth: " + error.message));
  const responses = [];
  page.on("response", res => {
    if (res.url().startsWith(api + "/")) responses.push({ path: new URL(res.url()).pathname, status: res.status() });
  });
  await page.goto(web, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Tài khoản" }).click();
  await page.getByRole("button", { name: "Đăng nhập / Tạo tài khoản" }).click();
  await page.getByRole("button", { name: "Đăng ký" }).click();
  const username = "qa" + randomUUID().replaceAll("-", "").slice(0, 16);
  const password = "CI-Temporary-Password-2026!";
  await page.getByRole("textbox", { name: "Tên đăng nhập" }).fill(username);
  await page.getByRole("textbox", { name: "Mật khẩu" }).fill(password);
  await page.getByRole("button", { name: "Tạo tài khoản", exact: true }).click();
  try {
    await page.getByText("Đã đăng nhập · CUSTOMER").waitFor({ timeout: 15000 });
  } catch (error) {
    // Diagnostic metadata only. Never print passwords, JWTs or response bodies.
    console.error("Registration HTTP statuses", JSON.stringify(responses));
    console.error("Visible login errors", JSON.stringify(await page.locator('[role="alert"]').allTextContents()));
    console.error("UI mode", JSON.stringify({
      registerTitle: await page.getByText("Tạo tài khoản mới").isVisible(),
      loggedInTextCount: await page.getByText("Đã đăng nhập · CUSTOMER").count(),
    }));
    await page.screenshot({ path: evidence + "/auth-registration-failed.png", fullPage: true });
    throw error;
  }
  assert.ok(responses.some(x => x.path === "/auth/register" && x.status === 201));
  assert.ok(responses.some(x => x.path === "/auth/me" && x.status === 200));
  await page.getByRole("button", { name: "Đăng xuất" }).click();
  await page.getByRole("button", { name: "Đăng nhập / Tạo tài khoản" }).click();
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).first().click();
  await page.getByRole("textbox", { name: "Tên đăng nhập" }).fill(username);
  await page.getByRole("textbox", { name: "Mật khẩu" }).fill("Incorrect-Password-2026!");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).last().click();
  await page.getByText("Tên đăng nhập hoặc mật khẩu không đúng.").waitFor({ timeout: 10000 });
  assert.ok(responses.some(x => x.path === "/auth/login" && x.status === 401));
  await page.getByRole("textbox", { name: "Mật khẩu" }).fill(password);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).last().click();
  await page.getByText("Đã đăng nhập · CUSTOMER").waitFor({ timeout: 15000 });
  assert.ok(responses.some(x => x.path === "/auth/logout" && x.status === 201));
  assert.ok(responses.some(x => x.path === "/auth/login" && x.status === 201));
  assert.ok(responses.filter(x => x.path === "/auth/me" && x.status === 200).length >= 2);
  await page.screenshot({ path: evidence + "/auth-success-390.png", fullPage: true });
  await ctx.close();
  assert.deepEqual(failures, []);
  console.log("PASS: real CI database signup, /auth/me, logout, wrong password 401, re-login");
  console.log("PASS: zero browser page exceptions");
} finally {
  await browser.close();
}
