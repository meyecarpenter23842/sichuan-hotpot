import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const socket = read("../src/dining-live.ts");
const app = read("../App.tsx");
test("L06 QR guest hints are grant-scoped and only cause authoritative refresh", () => {
  assert.match(socket, /scope: "dining_guest", token: credential/);
  assert.match(socket, /event\.sessionId === sessionId/);
  assert.match(socket, /onChange\(\)/);
  assert.match(app, /watchGuestDining\(credential, grant\.sessionId/);
  assert.match(app, /guestRef\.current/);
  assert.match(app, /setInterval\(/);
  assert.doesNotMatch(socket, /localStorage|lineTotalVnd|Bearer/);
});
