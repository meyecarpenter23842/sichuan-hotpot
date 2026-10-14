import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";

const api = "http://127.0.0.1:3001";
const web = "http://127.0.0.1:3000";
const evidence = "apps/customer/qa-artifacts";
mkdirSync(evidence, { recursive: true });
const jsFolder = "apps/customer/dist/_expo/static/js/web";
assert.ok(readdirSync(jsFolder).some(name => name.endsWith(".js")
  && readFileSync(jsFolder + "/" + name, "utf8").includes(api)), "Expo bundle missing QA API base URL");
const html = readFileSync("apps/customer/dist/index.html", "utf8");
assert.match(html, /user-scalable=no/);
assert.match(html, /maximum-scale=1/);
assert.match(html, /gesturestart/);
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
// Deterministic viewport QA uses the approved, tracked hero artwork. The remote
// R2 object's availability is a separate production probe, not a UI layout test.
const heroFixture = readFileSync("login-hero.png");
const heroUrl = "https://pub-63ed7b1c33514906ab6e2d82f41bffce.r2.dev/system-image/login-hero.png";
async function qaContext(options) {
  const ctx = await browser.newContext(options);
  await ctx.route(heroUrl, route => route.fulfill({
    status: 200, contentType: "image/png", body: heroFixture,
  }));
  return ctx;
}
const failures = [];
const getCode = async email => {
  const r = await fetch("http://127.0.0.1:3333/test/inbox?to=" + encodeURIComponent(email));
  assert.equal(r.status, 200, "CI captured verification email");
  const payload = await r.json();
  assert.match(payload.code, /^[0-9]{6}$/);
  return payload.code;
};
try {
  const allowed = await fetch(api + "/auth/login", { method: "OPTIONS",
    headers: { Origin: web, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" } });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("access-control-allow-origin"), web);
  const denied = await fetch(api + "/auth/login", { method: "OPTIONS",
    headers: { Origin: "https://malicious.example.test", "Access-Control-Request-Method": "POST" } });
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
  console.log("PASS: CORS allowed origin and rejected unknown origin");
  for (const [width, height] of [[320, 568], [360, 640], [390, 844], [428, 926], [768, 1024]]) {
    const ctx = await qaContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("pageerror", e => failures.push(width + "px: " + e.message));
    await page.goto(web, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.getByText("Đăng nhập", { exact: true }).first().waitFor();
    assert.equal(await page.getByRole("tab", { name: "Tôi" }).count(), 0, "global tab visible on login");
    assert.equal(await page.getByRole("button", { name: "Tiếp tục với Google" }).isDisabled(), true);
    assert.ok(await page.getByRole("img", { name: "Logo Google nhiều màu" }).count());
    await page.waitForFunction(() => Array.from(document.images).some(
      img => img.src.includes("login-hero.png") && img.complete && img.naturalWidth > 0,
    ), { timeout: 10000 });
    const metrics = await page.evaluate(() => ({
      width: innerWidth, docWidth: document.documentElement.scrollWidth,
      height: innerHeight, docHeight: document.documentElement.scrollHeight,
      hero: [...document.images].find(x => x.src.includes("login-hero.png"))?.naturalWidth,
      scrollAreas: [...document.querySelectorAll("*")].filter(e => {
        const css = getComputedStyle(e); return css.overflowY === "scroll" || css.overflowY === "auto";
      }).filter(e => e.scrollHeight > e.clientHeight + 2).length,
    }));
    assert.ok(metrics.docWidth <= width + 1, "horizontal overflow " + JSON.stringify(metrics));
    assert.ok(metrics.docHeight <= height + 1, "login page scrolls at " + width + "x" + height + ": " + JSON.stringify(metrics));
    assert.equal(metrics.hero, 1448);
    // Compact screens must not overlay another headline over the hero's lettering.
    assert.equal(await page.getByText("Chào mừng", { exact: true }).count(),
      height < 750 || width <= 350 ? 0 : 1, "hero text collision risk at " + width + "x" + height);
    for (const control of [
      page.getByRole("textbox", { name: "Tên đăng nhập" }),
      page.getByRole("textbox", { name: "Mật khẩu" }),
      page.getByRole("button", { name: "Đăng nhập", exact: true }).last(),
      page.getByRole("button", { name: "Tiếp tục với Google" }),
      page.getByRole("button", { name: "Đăng ký" }),
      page.getByRole("button", { name: /Xem thực đơn mà không cần đăng nhập/ }),
    ]) {
      const rect = await control.boundingBox();
      assert.ok(rect && rect.x >= -1 && rect.y >= -1
        && rect.x + rect.width <= width + 1 && rect.y + rect.height <= height + 1,
        "clipped login control at " + width + "x" + height + ": " + JSON.stringify(rect));
    }
    await page.screenshot({ path: evidence + "/login-red-white-" + width + "x" + height + ".png", fullPage: true });
    await page.getByRole("button", { name: "Đăng ký" }).click();
    await page.getByText("Tạo tài khoản", { exact: true }).first().waitFor();
    await page.getByRole("button", { name: "Gửi mã đăng ký" }).click();
    await page.getByText(/Tên đăng nhập: 3–32 ký tự/).waitFor();
    await page.getByRole("button", { name: "Quay lại đăng nhập" }).click();
    await page.getByRole("button", { name: /Xem thực đơn mà không cần đăng nhập/ }).click();
    await page.getByRole("tab", { name: "Trang chủ" }).waitFor();
    await ctx.close();
    console.log("PASS: " + width + "x" + height + " login-first, no scrolling, tracked hero fixture and guest access");
  }
  const ctx = await qaContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on("pageerror", e => failures.push("registration: " + e.message));
  const responses = [];
  page.on("response", r => { if (r.url().startsWith(api + "/"))
    responses.push({ path: new URL(r.url()).pathname, status: r.status() }); });
  const username = "qa" + randomUUID().replaceAll("-", "").slice(0, 16);
  const email = "qa" + randomUUID().replaceAll("-", "") + "@example.test";
  const password = "lauxuyen";
  await page.goto(web, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByRole("button", { name: "Đăng ký" }).click();
  await page.getByRole("textbox", { name: "Tên đăng nhập" }).fill(username);
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("textbox", { name: "Mật khẩu" }).fill(password);
  await page.getByRole("button", { name: "Gửi mã đăng ký" }).click();
  await page.getByText("Xác minh email", { exact: true }).waitFor();
  const code = await getCode(email);
  await page.getByRole("textbox", { name: "Mã xác minh (6 số)" }).fill(code);
  await page.getByRole("button", { name: "Xác nhận mã và tạo tài khoản" }).click();
  try {
    await page.getByRole("tab", { name: "Tôi" }).waitFor({ timeout: 10000 });
  } catch (error) {
    // Surface only HTTP statuses and generic UI labels; never log passwords, email, OTP or JWT.
    console.error("Signup API statuses", JSON.stringify(responses));
    console.error("Signup visible alerts", JSON.stringify(
      (await page.locator('[role="alert"]').allTextContents()).map(v => v.slice(0, 140)),
    ));
    console.error("Signup page controls", JSON.stringify({
      confirmButton: await page.getByRole("button", { name: "Xác nhận mã và tạo tài khoản" }).count(),
      loginTabs: await page.getByRole("tab").count(),
      headingCount: await page.getByText("Xác minh email", { exact: true }).count(),
    }));
    await page.screenshot({ path: evidence + "/auth-confirm-debug.png", fullPage: true });
    throw error;
  }
  await page.getByRole("tab", { name: "Tôi" }).click();
  await page.getByText("Tài khoản khách hàng", { exact: true }).waitFor({ timeout: 15000 });
  // New requirement: session survives a full PWA refresh, not just navigation.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "Tôi" }).waitFor();
  await page.getByRole("tab", { name: "Tôi" }).click();
  await page.getByText("Tài khoản khách hàng", { exact: true }).waitFor();
  assert.ok(responses.some(x => x.path === "/auth/register/request-code" && x.status === 201));
  assert.ok(responses.some(x => x.path === "/auth/register/confirm-code" && x.status === 201));
  await page.getByRole("button", { name: "Đăng xuất" }).click();
  await page.getByRole("textbox", { name: "Tên đăng nhập" }).waitFor();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("textbox", { name: "Tên đăng nhập" }).waitFor();
  assert.equal(await page.getByRole("tab", { name: "Tôi" }).count(), 0,
    "explicit sign out remains signed out after reload");
  await page.getByRole("textbox", { name: "Tên đăng nhập" }).fill(username);
  await page.getByRole("textbox", { name: "Mật khẩu" }).fill("wrong123");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).last().click();
  await page.getByText("Tên đăng nhập hoặc mật khẩu không đúng.").waitFor();
  assert.ok(responses.some(x => x.path === "/auth/login" && x.status === 401));
  await page.getByRole("textbox", { name: "Mật khẩu" }).fill(password);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).last().click();
  await page.getByRole("tab", { name: "Tôi" }).click();
  await page.getByText("Tài khoản khách hàng", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Đăng xuất" }).click();
  await page.getByRole("button", { name: "Quên mật khẩu?" }).click();
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("button", { name: "Gửi mã khôi phục" }).click();
  await page.getByText("Đặt lại mật khẩu", { exact: true }).waitFor();
  await page.getByRole("textbox", { name: "Mã xác minh (6 số)" }).fill(await getCode(email));
  await page.getByRole("textbox", { name: "Mật khẩu mới" }).fill("newpass1");
  await page.getByRole("button", { name: "Đổi mật khẩu" }).click();
  await page.getByRole("textbox", { name: "Tên đăng nhập" }).fill(username);
  await page.getByRole("textbox", { name: "Mật khẩu" }).fill("newpass1");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).last().click();
  await page.getByRole("tab", { name: "Tôi" }).click();
  await page.getByText("Tài khoản khách hàng", { exact: true }).waitFor();
  await page.screenshot({ path: evidence + "/email-verification-password-reset.png", fullPage: true });
  await ctx.close();
  assert.deepEqual(failures, []);
  console.log("PASS: real CI email code registration, username login, incorrect password and reset");
} finally {
  await browser.close();
}
