import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const src = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
test("Android frozen ticket is persisted before POST and cleared only after response", () => {
  const app = src("App.tsx");
  assert.ok(app.indexOf("await writeFrozenTicket({") < app.indexOf("const result = await api<Receipt>"));
  assert.ok(app.indexOf("const result = await api<Receipt>") < app.indexOf("await writeFrozenTicket(null)"));
  assert.match(app, /stored\.staffId === person\.id/);
  assert.match(app, /setPendingSubmit\(\{ sessionId: recovered\.sessionId/);
});
test("Payment recovery is scoped by branch and session, never stores bearer tokens", () => {
  const panel = src("src/RetailSettlementPanel.tsx");
  assert.ok(panel.indexOf("await writeFrozenPayment(branchId, sessionId, draft)") <
    panel.indexOf("const result = await api<Pay>"));
  assert.ok(panel.indexOf("const result = await api<Pay>") <
    panel.indexOf("await writeFrozenPayment(branchId, sessionId, null)"));
  const native = src("src/retail-recovery.native.ts");
  assert.match(native, /encodeURIComponent\(branchId\)/);
  assert.doesNotMatch(native, /accessToken|refreshToken/);
});
test("Web draft adapter does not use persistent browser storage", () => {
  assert.doesNotMatch(src("src/retail-recovery.ts"), /localStorage\.|sessionStorage\./);
});
