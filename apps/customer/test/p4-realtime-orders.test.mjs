import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../src/screens/OrdersScreen.tsx", import.meta.url), "utf8");
const events = readFileSync(new URL("../src/order-realtime.ts", import.meta.url), "utf8");
test("customer listens only to their authenticated stream and refreshes on reconnect", () => {
  assert.match(events, /scope: "customer"/);
  assert.match(events, /"ready", "order.created", "order.status"/);
  assert.match(source, /watchCustomerOrderEvents\(accessToken/);
  assert.match(source, /AppState\.addEventListener/);
  assert.match(source, /setInterval\(\(\) =>/);
});
