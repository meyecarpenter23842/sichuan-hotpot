-- Additive #129, preserve all existing address and order data.
ALTER TABLE "Branch" ADD COLUMN "catalogVersion" VARCHAR(40);
ALTER TABLE "Branch" ADD COLUMN "provinceCode" VARCHAR(24);
ALTER TABLE "Branch" ADD COLUMN "wardCode" VARCHAR(24);
