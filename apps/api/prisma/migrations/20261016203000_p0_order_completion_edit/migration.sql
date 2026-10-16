-- P0 order completion/edit: additive audit + selection identity for safe server repricing.
CREATE TYPE "OrderItemPricingMode" AS ENUM ('LEGACY', 'SEPARATE');

ALTER TABLE "OrderItem"
  ADD COLUMN "variantId" UUID,
  ADD COLUMN "pricingMode" "OrderItemPricingMode" NOT NULL DEFAULT 'LEGACY';

ALTER TABLE "OrderItemModifierSnapshot"
  ADD COLUMN "optionId" UUID;

CREATE TABLE "OrderEditAudit" (
  "id" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "actorId" UUID,
  "reason" VARCHAR(500) NOT NULL,
  "status" "OrderStatus" NOT NULL,
  "beforeSubtotalVnd" INTEGER NOT NULL,
  "afterSubtotalVnd" INTEGER NOT NULL,
  "beforeTotalVnd" INTEGER NOT NULL,
  "afterTotalVnd" INTEGER NOT NULL,
  "beforeItems" JSONB NOT NULL,
  "afterItems" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderEditAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrderItem_variantId_idx" ON "OrderItem"("variantId");
CREATE INDEX "OrderItemModifierSnapshot_optionId_idx" ON "OrderItemModifierSnapshot"("optionId");
CREATE INDEX "OrderEditAudit_orderId_createdAt_idx" ON "OrderEditAudit"("orderId", "createdAt");
CREATE INDEX "OrderEditAudit_actorId_createdAt_idx" ON "OrderEditAudit"("actorId", "createdAt");

ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_variantId_fkey"
  FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OrderItemModifierSnapshot"
  ADD CONSTRAINT "OrderItemModifierSnapshot_optionId_fkey"
  FOREIGN KEY ("optionId") REFERENCES "ModifierOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OrderEditAudit"
  ADD CONSTRAINT "OrderEditAudit_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrderEditAudit"
  ADD CONSTRAINT "OrderEditAudit_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
