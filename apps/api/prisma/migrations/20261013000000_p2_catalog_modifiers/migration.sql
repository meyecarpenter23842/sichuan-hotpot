-- P2.2 DEV/CI ONLY; additive schema, no destructive changes, production NOT approved.
ALTER TABLE "Product" ADD COLUMN "imageKey" VARCHAR(512);

CREATE TABLE "ModifierGroup" (
  "id" UUID NOT NULL,
  "productId" UUID NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "minSelect" INTEGER NOT NULL DEFAULT 0,
  "maxSelect" INTEGER NOT NULL DEFAULT 1,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "ModifierGroup_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ModifierGroup_selection_bounds_check" CHECK ("minSelect" >= 0 AND "maxSelect" >= "minSelect" AND "maxSelect" <= 30)
);
CREATE UNIQUE INDEX "ModifierGroup_productId_name_key" ON "ModifierGroup"("productId","name");
CREATE INDEX "ModifierGroup_productId_sortOrder_idx" ON "ModifierGroup"("productId","sortOrder");
ALTER TABLE "ModifierGroup" ADD CONSTRAINT "ModifierGroup_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ModifierOption" (
  "id" UUID NOT NULL,
  "groupId" UUID NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "priceDeltaVnd" INTEGER NOT NULL DEFAULT 0,
  "isAvailable" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "ModifierOption_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ModifierOption_price_nonnegative_check" CHECK ("priceDeltaVnd" >= 0)
);
CREATE UNIQUE INDEX "ModifierOption_groupId_name_key" ON "ModifierOption"("groupId","name");
ALTER TABLE "ModifierOption" ADD CONSTRAINT "ModifierOption_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "ModifierGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
