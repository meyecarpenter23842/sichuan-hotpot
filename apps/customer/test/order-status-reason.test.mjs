import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const orders = readFileSync(new URL("../src/screens/OrdersScreen.tsx", import.meta.url), "utf8");
test("customer order timeline shows cancellation/rejection reason from backend", () => {
  assert.match(orders, /event\.reason/);
  assert.match(orders, /Lý do: \{event\.reason\}/);
});
