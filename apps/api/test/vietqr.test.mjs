import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { configuredQr, qrInstructions } = require("../dist/payments/vietqr.js");
const orderId = randomUUID();
test("QR is disabled until real merchant settings are complete and valid", () => {
  const values = ["VIETQR_BANK_BIN", "VIETQR_ACCOUNT_NO", "VIETQR_ACCOUNT_NAME"];
  const saved = values.map(k => process.env[k]);
  try {
    values.forEach(k => delete process.env[k]);
    assert.equal(configuredQr(), null);
    process.env.VIETQR_BANK_BIN = "not-a-bin";
    process.env.VIETQR_ACCOUNT_NO = "12345678";
    process.env.VIETQR_ACCOUNT_NAME = "CUA HANG";
    assert.equal(configuredQr(), null);
    process.env.VIETQR_BANK_BIN = "970415";
    assert.deepEqual(configuredQr(), {
      bankBin: "970415", accountNo: "12345678", accountName: "CUA HANG",
    });
  } finally {
    values.forEach((k, i) => {
      if (saved[i] === undefined) delete process.env[k];
      else process.env[k] = saved[i];
    });
  }
});
test("QR image is bank-transfer instructions with exact server amount and reference, not paid proof", () => {
  const row = { method: "QR", qrBankBin: "970415",
    qrAccountNo: "12345678", qrAccountName: "LẨU TỨ XUYÊN" };
  const qr = qrInstructions(orderId, 115000, row);
  assert.equal(qr.amountVnd, 115000);
  assert.equal(qr.transferReference.length, 35);
  const url = new URL(qr.imageUrl);
  assert.equal(url.origin, "https://img.vietqr.io");
  assert.equal(url.searchParams.get("amount"), "115000");
  assert.equal(url.searchParams.get("addInfo"), qr.transferReference);
  assert.equal(url.searchParams.get("accountName"), "LẨU TỨ XUYÊN");
  assert.equal(qrInstructions(orderId, 115000, { ...row, method: "COD" }), null);
  assert.equal(qrInstructions(orderId, 0, row), null);
});
