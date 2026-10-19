import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const app = read("../App.tsx");
const proxy = read("../src/auth/browser-session.ts");
const config = read("../../../scripts/qa/create-pwa-output-config.mjs");
const workflow = read("../../../.github/workflows/vercel-pwa-release-manual.yml");

test("network/proxy session outage cannot cover the public iPhone menu", () => {
  assert.match(app, /setAuthRestoreError\("Chưa thể khôi phục đăng nhập/);
  assert.doesNotMatch(app, /\) : authRestoreError \? \(/);
  assert.match(app, /\) : screen === "login" \? \(/);
  assert.match(app, /!!authRestoreError && <>/);
  assert.match(app, /label="Thử khôi phục đăng nhập"/);
  assert.match(app, /setAuthRestoreAttempt\(n => n \+ 1\)/);
});

test("failed recovery keeps browser session cookie and only invalidates on 401", () => {
  assert.match(app, /error instanceof ApiRequestError && error.status === 401/);
  assert.match(app, /await AsyncStorage.removeItem\(WEB_SESSION_MARKER\)/);
  assert.match(app, /A transient proxy\/network failure is NOT proof/);
  assert.match(app, /if \(!tokens\) return/);
  assert.match(proxy, /credentials: "same-origin"/);
  assert.match(proxy, /new ApiRequestError\("Phiên đăng nhập không còn hợp lệ\.", 401\)/);
});

test("release workflow deploys the same-origin session route and verifies canonical host", () => {
  assert.match(config, /src: "\^\/api\/session\/\(start\|refresh\|logout\)\$"/);
  assert.match(workflow, /vercel deploy --prebuilt --prod/);
  assert.match(workflow, /Verify canonical PWA session proxy after deployment/);
  assert.match(workflow, /canonical="https:\/\/www\.bepsi\.click"/);
  assert.match(workflow, /canonical="https:\/\/admin\.bepsi\.click"/);
  assert.match(workflow, /\$canonical\/api\/session\/refresh/);
  assert.match(workflow, /test "\$status" = 401/);
});
