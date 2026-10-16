-- Combo catalog: additive product kind, composition and immutable order snapshots.
CREATE TYPE "ProductKind" AS ENUM ('STANDARD', 'COMBO');
CREATE TYPE "ComboSnapshotKind" AS ENUM ('FIXED', 'CHOICE');

ALTER TABLE "Product"
  ADD COLUMN "kind" "ProductKind" NOT NULL DEFAULT 'STANDARD';

CREATE TABLE "ProductComboFixedItem" (
  "id" UUID NOT NULL,
  "comboProductId" UUID NOT NULL,
  "childProductId" UUID NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "ProductComboFixedItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductComboGroup" (
  "id" UUID NOT NULL,
  "comboProductId" UUID NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "minSelect" INTEGER NOT NULL DEFAULT 1,
  "maxSelect" INTEGER NOT NULL DEFAULT 1,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "ProductComboGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductComboOption" (
  "id" UUID NOT NULL,
  "groupId" UUID NOT NULL,
  "childProductId" UUID NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "priceDeltaVnd" INTEGER NOT NULL DEFAULT 0,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "ProductComboOption_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderItemComboSnapshot" (
  "id" UUID NOT NULL,
  "orderItemId" UUID NOT NULL,
  "productId" UUID,
  "kind" "ComboSnapshotKind" NOT NULL,
  "groupName" VARCHAR(160),
  "productName" VARCHAR(200) NOT NULL,
  "quantity" INTEGER NOT NULL,
  "priceDeltaVnd" INTEGER NOT NULL DEFAULT 0,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "OrderItemComboSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductComboFixedItem_comboProductId_childProductId_key"
  ON "ProductComboFixedItem"("comboProductId", "childProductId");
CREATE INDEX "ProductComboFixedItem_comboProductId_sortOrder_idx"
  ON "ProductComboFixedItem"("comboProductId", "sortOrder");
CREATE INDEX "ProductComboFixedItem_childProductId_idx"
  ON "ProductComboFixedItem"("childProductId");

CREATE UNIQUE INDEX "ProductComboGroup_comboProductId_name_key"
  ON "ProductComboGroup"("comboProductId", "name");
CREATE INDEX "ProductComboGroup_comboProductId_sortOrder_idx"
  ON "ProductComboGroup"("comboProductId", "sortOrder");

CREATE UNIQUE INDEX "ProductComboOption_groupId_childProductId_key"
  ON "ProductComboOption"("groupId", "childProductId");
CREATE INDEX "ProductComboOption_groupId_sortOrder_idx"
  ON "ProductComboOption"("groupId", "sortOrder");
CREATE INDEX "ProductComboOption_childProductId_idx"
  ON "ProductComboOption"("childProductId");

CREATE INDEX "OrderItemComboSnapshot_orderItemId_sortOrder_idx"
  ON "OrderItemComboSnapshot"("orderItemId", "sortOrder");
CREATE INDEX "OrderItemComboSnapshot_productId_idx"
  ON "OrderItemComboSnapshot"("productId");

ALTER TABLE "ProductComboFixedItem"
  ADD CONSTRAINT "ProductComboFixedItem_comboProductId_fkey"
  FOREIGN KEY ("comboProductId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductComboFixedItem"
  ADD CONSTRAINT "ProductComboFixedItem_childProductId_fkey"
  FOREIGN KEY ("childProductId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductComboGroup"
  ADD CONSTRAINT "ProductComboGroup_comboProductId_fkey"
  FOREIGN KEY ("comboProductId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductComboOption"
  ADD CONSTRAINT "ProductComboOption_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "ProductComboGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductComboOption"
  ADD CONSTRAINT "ProductComboOption_childProductId_fkey"
  FOREIGN KEY ("childProductId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderItemComboSnapshot"
  ADD CONSTRAINT "OrderItemComboSnapshot_orderItemId_fkey"
  FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderItemComboSnapshot"
  ADD CONSTRAINT "OrderItemComboSnapshot_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
