import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

test("Web Push waits for an active service worker before subscribing", () => {
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

test("iPhone browser gets install guidance instead of a fake permission error", () => {
  const helper = read("../src/web-push-service-worker.ts");
  assert.match(helper, /iPad\|iPhone\|iPod/);
  assert.match(helper, /display-mode: standalone/);
  assert.match(helper, /Safari → Chia sẻ → Thêm vào Màn hình chính/);
});

test("app startup prepares the worker without requesting notification permission", () => {
  const client = read("../src/push-client.web.ts");
  const start = client.indexOf("export async function configureCustomerNotificationPresentation");
  const end = client.indexOf("export async function enableCustomerPush");
  const startup = client.slice(start, end);
  assert.match(startup, /ensureHotpotServiceWorkerRegistration/);
  assert.doesNotMatch(startup, /Notification\.requestPermission/);
});
