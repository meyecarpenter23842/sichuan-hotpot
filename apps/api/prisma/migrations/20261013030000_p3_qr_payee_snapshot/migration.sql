-- Nullable snapshots preserve existing payments; no production migration is authorized.
ALTER TABLE "Payment"
  ADD COLUMN "qrBankBin" VARCHAR(6),
  ADD COLUMN "qrAccountNo" VARCHAR(19),
  ADD COLUMN "qrAccountName" VARCHAR(80);
