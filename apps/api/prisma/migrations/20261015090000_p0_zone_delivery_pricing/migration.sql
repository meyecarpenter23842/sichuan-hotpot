-- #128 additive, reversible without touching legacy rows. Rollback only before ZONE orders exist.
CREATE TYPE "DeliveryPricingMode" AS ENUM ('DISTANCE', 'ZONE');
ALTER TABLE "DeliveryPolicyVersion" ADD COLUMN "pricingMode" "DeliveryPricingMode" NOT NULL DEFAULT 'DISTANCE';
ALTER TABLE "DeliveryPolicyVersion" ALTER COLUMN "baseMeters" DROP NOT NULL;
ALTER TABLE "DeliveryPolicyVersion" ALTER COLUMN "baseFeeVnd" DROP NOT NULL;
ALTER TABLE "DeliveryPolicyVersion" ALTER COLUMN "extraStepMeters" DROP NOT NULL;
ALTER TABLE "DeliveryPolicyVersion" ALTER COLUMN "extraStepFeeVnd" DROP NOT NULL;
ALTER TABLE "DeliveryPolicyVersion" ALTER COLUMN "maxRoadMeters" DROP NOT NULL;
ALTER TABLE "Address" ADD COLUMN "catalogVersion" VARCHAR(40);
ALTER TABLE "Address" ADD COLUMN "provinceCode" VARCHAR(24);
ALTER TABLE "Address" ADD COLUMN "wardCode" VARCHAR(24);
CREATE TABLE "DeliveryZone" (
  "id" UUID NOT NULL,
  "policyVersionId" UUID NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "catalogVersion" VARCHAR(40) NOT NULL,
  "provinceCode" VARCHAR(24) NOT NULL,
  "wardCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "feeVnd" INTEGER NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "DeliveryZone_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DeliveryZone_policyVersionId_provinceCode_idx" ON "DeliveryZone"("policyVersionId", "provinceCode");
ALTER TABLE "DeliveryZone" ADD CONSTRAINT "DeliveryZone_policyVersionId_fkey"
  FOREIGN KEY ("policyVersionId") REFERENCES "DeliveryPolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ALTER COLUMN "roadDistanceMeters" DROP NOT NULL;
ALTER TABLE "Order" ADD COLUMN "pricingMode" "DeliveryPricingMode" NOT NULL DEFAULT 'DISTANCE';
ALTER TABLE "Order" ADD COLUMN "zoneId" UUID;
ALTER TABLE "Order" ADD COLUMN "zoneNameSnapshot" VARCHAR(160);
ALTER TABLE "Order" ADD COLUMN "provinceCodeSnapshot" VARCHAR(24);
ALTER TABLE "Order" ADD COLUMN "wardCodeSnapshot" VARCHAR(24);
ALTER TABLE "Order" ADD COLUMN "catalogVersionSnapshot" VARCHAR(40);
ALTER TABLE "Order" ADD CONSTRAINT "Order_zoneId_fkey"
  FOREIGN KEY ("zoneId") REFERENCES "DeliveryZone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Order_zoneId_idx" ON "Order"("zoneId");
ALTER TABLE "DeliveryZone" ADD CONSTRAINT "DeliveryZone_fee_nonnegative" CHECK ("feeVnd" >= 0);
ALTER TABLE "Order" ADD CONSTRAINT "Order_pricing_mode_snapshot_valid" CHECK (
  ("pricingMode" = 'DISTANCE' AND "roadDistanceMeters" IS NOT NULL) OR
  ("pricingMode" = 'ZONE' AND "roadDistanceMeters" IS NULL
    AND "zoneId" IS NOT NULL AND "zoneNameSnapshot" IS NOT NULL
    AND "provinceCodeSnapshot" IS NOT NULL AND "wardCodeSnapshot" IS NOT NULL
    AND "catalogVersionSnapshot" IS NOT NULL)
);
