import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

test("Admin Web Push waits for the active root service worker", () => {
  const helper = read("../src/web-push-service-worker.ts");
  const client = read("../src/push-client.web.ts");
  const worker = read("../public/hotpot-sw.js");

  assert.match(helper, /navigator\.serviceWorker\.ready/);
  assert.match(helper, /updateViaCache: "none"/);
  const ensureIndex = client.indexOf("await ensureHotpotServiceWorkerRegistration()");
  const subscribeIndex = client.indexOf("pushManager.subscribe");
  assert.ok(ensureIndex >= 0 && subscribeIndex > ensureIndex);
  assert.match(worker, /skipWaiting\(\)/);
  assert.match(worker, /clients\.claim\(\)/);
});

test("Admin reuses an existing subscription and separates blocked permission from iPhone install", () => {
  const client = read("../src/push-client.web.ts");
  const helper = read("../src/web-push-service-worker.ts");
  const registerSlice = client.slice(
    client.indexOf("async function registerWeb"),
    client.indexOf("export async function configureAdminNotificationPresentation"),
  );

  assert.match(registerSlice, /pushManager\.getSubscription\(\)/);
  assert.doesNotMatch(registerSlice, /const old =/);
  assert.match(registerSlice, /Quyền thông báo đang bị chặn/);
  assert.match(helper, /Safari → Chia sẻ → Thêm vào Màn hình chính/);
});
