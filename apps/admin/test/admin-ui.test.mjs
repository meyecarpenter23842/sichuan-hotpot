import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const catalog = readFileSync(new URL("../src/CatalogPanel.tsx", import.meta.url), "utf8");
const hours = readFileSync(new URL("../src/HoursPanel.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
const theme = readFileSync(new URL("../src/theme.ts", import.meta.url), "utf8");

test("independent Admin app uses real sign-in and branch-scoped role checks", () => {
  assert.match(app, /request<Principal>\("\/auth\/me"/);
  assert.match(app, /request<Branch\[]>\("\/admin\/branches"/);
  assert.match(app, /available\.length === 0/);
  assert.doesNotMatch(app, /user\.role !== "OWNER" && user\.role !== "MANAGER"/);
  assert.match(app, /"\/admin\/branches"/);
  assert.match(app, /request<AuthTokens>\("\/auth\/login"/);
  assert.match(app, /placeholder="Nhập mật khẩu"/);
  assert.doesNotMatch(app, /placeholder="6–8 ký tự"/);
  assert.match(app, /refreshSession/);
  assert.match(app, /forgetSession/);
  assert.match(api, /Platform\.OS === "web"/);
  assert.match(api, /SecureStore\.setItemAsync/);
  assert.doesNotMatch(api, /AsyncStorage\.setItem\(REFRESH_KEY/);
});

test("Admin cards and text are compact per the approved reference", () => {
  assert.match(theme, /caption: 11, note: 12, body: 13, action: 13, section: 14, title: 17/);
  assert.match(app, /fontSize: font\.title/);
  assert.match(app, /fontSize: font\.section/);
  assert.match(catalog, /minHeight: 65/);
  assert.doesNotMatch(catalog, /fontSize:\s*(?:2[3-9]|[3-9][0-9])/);
});

test("all catalog operations are backed by branch-scoped real API calls", () => {
  assert.match(catalog, /"\/products\/"/);
  assert.match(catalog, /"\/categories"/);
  assert.match(catalog, /"\/variants\/"/);
  assert.match(catalog, /"\/groups\/"/);
  assert.match(catalog, /"\/options\/"/);
  assert.match(catalog, /"DELETE"/);
  assert.match(catalog, /request\(root \+ path, token, method, body\)/);
  assert.match(catalog, /uploadUrl/);
  assert.match(catalog, /"\/images\/attach"/);
  assert.match(catalog, /Tạm hết/);
});

test("opening hours remain explicitly unconfigured until operator saves", () => {
  assert.match(hours, /catalog\.openingHours\.length === 0/);
  assert.match(hours, /opening-hours/);
  assert.match(hours, /method|PUT/);
  assert.match(hours, /HH:mm/);
});
