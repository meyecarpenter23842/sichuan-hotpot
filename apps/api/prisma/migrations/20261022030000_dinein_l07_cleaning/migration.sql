-- L07: closing a dining session marks its physical table awaiting cleaning.
-- Existing tables start clean; no production rows are deleted or rewritten.
ALTER TABLE "DiningTable" ADD COLUMN "needsCleaning" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DiningPayment" ADD COLUMN "qrBankBin" VARCHAR(6),
  ADD COLUMN "qrAccountNo" VARCHAR(19),
  ADD COLUMN "qrAccountName" VARCHAR(80);
ALTER TABLE "DiningPayment" ADD COLUMN "cashReceivedVnd" INTEGER;
