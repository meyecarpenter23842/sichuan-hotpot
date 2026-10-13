-- DEV/CI schema change only; never run on production without explicit release approval.
-- Nullable additions preserve existing orders; new checkout always populates both.
ALTER TABLE "Order"
  ADD COLUMN "requestHash" VARCHAR(64),
  ADD COLUMN "phoneSnapshot" VARCHAR(20);
