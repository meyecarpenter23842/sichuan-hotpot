import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const admin = readFileSync(new URL("../../admin/src/pwa-viewport.ts", import.meta.url), "utf8");
const customer = readFileSync(new URL("../src/pwa-viewport.ts", import.meta.url), "utf8");
const index = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
test("both installed PWAs keep device viewport width and do not cancel one-finger scroll", () => {
  for (const source of [admin, customer]) {
    assert.match(source, /width=device-width,initial-scale=1/);
    assert.match(source, /maximum-scale=1,user-scalable=no/);
    assert.match(source, /touch-action", "pan-x pan-y"/);
    assert.match(source, /gesturestart/);
    assert.doesNotMatch(source, /touchstart.*preventDefault/);
  }
  assert.match(index, /configureCustomerViewport\(\)/);
});
