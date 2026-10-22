import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const app = read("../App.tsx");
const socket = read("../src/dining-live.ts");
const push = read("../src/dining-push.ts");
const sw = read("../public/hotpot-sw.js");
test("L06 Retail QR hints only refresh branch-authorized HTTP truth", () => {
  assert.match(socket, /scope: "staff", token, branchId/);
  assert.match(socket, /event\.branchId === branchId/);
  assert.match(app, /seenPending\.current\.has/);
  assert.match(app, /Chuông QR,/);
  assert.match(app, /playRetailQrAlert\(true\)/);
  assert.match(app, /onReady: \(\) => \{ void refresh\(\); \}/);
});
test("L06 Retail background notifications require explicit user opt-in", () => {
  assert.match(app, /enableRetailDiningPush\(branchId\)/);
  assert.match(push, /Notification\.requestPermission\(\)/);
  assert.match(push, /scope: "STAFF", transport: "WEB_PUSH", branchId/);
  assert.match(sw, /data\.kind !== "DINING_PENDING"/);
  assert.doesNotMatch(sw, /lineTotal|customerNote|Bearer|sessionId/);
});
