import assert from "node:assert/strict";
import test from "node:test";
import { tableQrMatrix, tableQrSvg, tableQrUrl } from "../src/table-qr.mjs";

test("fixed table locator is printed, never a guest bearer credential", () => {
  const locator = tableQrUrl("test_v4_12345678901234567890");
  assert.equal(locator, "https://menu.bepsi.click/?table=test_v4_12345678901234567890");
  const matrix = tableQrMatrix(locator);
  assert.equal(matrix.length, 37);
  assert.ok(matrix.every(row => row.length === 37 && row.every(x => typeof x === "boolean")));
  assert.equal(matrix[0][0], true);
  assert.ok(tableQrSvg(locator).includes("<svg"));
  assert.ok(tableQrSvg(locator).includes("viewBox=\"0 0 45 45\""));
});
test("QR never encodes unbounded or unverified handles", () => {
  assert.throws(() => tableQrUrl("tiny"), /INVALID_QR_HANDLE/);
  assert.throws(() => tableQrUrl("../etc/password".repeat(6)), /INVALID_QR_HANDLE/);
  assert.throws(() => tableQrMatrix("a".repeat(200)), /QR_URL_TOO_LONG/);
});
