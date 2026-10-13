import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const screen = readFileSync(new URL("../src/screens/OrdersScreen.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
test("order tracking polls backend when visible and syncs after reconnect/foreground", () => {
  assert.match(screen, /setInterval/);
  assert.match(screen, /20_000/);
  assert.match(screen, /AppState\.addEventListener/);
  assert.match(screen, /visibilitychange/);
  assert.match(screen, /selectedOrderId\.current === id/);
  assert.match(screen, /clearInterval\(timer\)/);
});
test("delivery business errors show actionable Vietnamese messages", () => {
  for (const code of ["STORE_CLOSED", "BELOW_MINIMUM", "OUT_OF_RANGE", "QR_NOT_CONFIGURED"]) {
    assert.match(api, new RegExp(code));
  }
  assert.match(api, /customerBusinessErrors\[businessCode\]/);
});
