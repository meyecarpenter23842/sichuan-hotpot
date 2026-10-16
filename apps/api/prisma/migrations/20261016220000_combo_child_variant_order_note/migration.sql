-- Combo child variants + customer order note. Additive only.
ALTER TABLE "Order"
  ADD COLUMN "customerNote" VARCHAR(500);

ALTER TABLE "ProductComboFixedItem"
  ADD COLUMN "variantId" UUID;

ALTER TABLE "ProductComboOption"
  ADD COLUMN "variantId" UUID;

ALTER TABLE "OrderItemComboSnapshot"
  ADD COLUMN "variantId" UUID,
  ADD COLUMN "variantName" VARCHAR(160);

CREATE INDEX "ProductComboFixedItem_variantId_idx"
  ON "ProductComboFixedItem"("variantId");
CREATE INDEX "ProductComboOption_variantId_idx"
  ON "ProductComboOption"("variantId");
CREATE INDEX "OrderItemComboSnapshot_variantId_idx"
  ON "OrderItemComboSnapshot"("variantId");

ALTER TABLE "ProductComboFixedItem"
  ADD CONSTRAINT "ProductComboFixedItem_variantId_fkey"
  FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductComboOption"
  ADD CONSTRAINT "ProductComboOption_variantId_fkey"
  FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrderItemComboSnapshot"
  ADD CONSTRAINT "OrderItemComboSnapshot_variantId_fkey"
  FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
