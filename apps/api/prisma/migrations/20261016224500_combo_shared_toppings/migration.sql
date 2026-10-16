-- Allow combo choice groups to reuse shared modifier/topping library options.
CREATE TABLE "ProductComboModifierOption" (
  "id" UUID NOT NULL,
  "groupId" UUID NOT NULL,
  "modifierOptionId" UUID NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "priceDeltaVnd" INTEGER NOT NULL DEFAULT 0,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "ProductComboModifierOption_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductComboModifierOption_groupId_modifierOptionId_key"
  ON "ProductComboModifierOption"("groupId", "modifierOptionId");
CREATE INDEX "ProductComboModifierOption_groupId_sortOrder_idx"
  ON "ProductComboModifierOption"("groupId", "sortOrder");
CREATE INDEX "ProductComboModifierOption_modifierOptionId_idx"
  ON "ProductComboModifierOption"("modifierOptionId");

ALTER TABLE "ProductComboModifierOption"
  ADD CONSTRAINT "ProductComboModifierOption_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "ProductComboGroup"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductComboModifierOption"
  ADD CONSTRAINT "ProductComboModifierOption_modifierOptionId_fkey"
  FOREIGN KEY ("modifierOptionId") REFERENCES "ModifierOption"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrderItemComboSnapshot"
  ADD COLUMN "modifierOptionId" UUID;

CREATE INDEX "OrderItemComboSnapshot_modifierOptionId_idx"
  ON "OrderItemComboSnapshot"("modifierOptionId");

ALTER TABLE "OrderItemComboSnapshot"
  ADD CONSTRAINT "OrderItemComboSnapshot_modifierOptionId_fkey"
  FOREIGN KEY ("modifierOptionId") REFERENCES "ModifierOption"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
