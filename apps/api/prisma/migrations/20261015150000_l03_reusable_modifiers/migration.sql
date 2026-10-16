-- L03: additive relationship, preserve original ModifierGroup and ModifierOption IDs.
ALTER TABLE "CatalogCategory" ADD COLUMN "imageKey" VARCHAR(512);
ALTER TABLE "ModifierGroup" ADD COLUMN "branchId" UUID,
  ADD COLUMN "isAvailable" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "imageKey" VARCHAR(512);
ALTER TABLE "ModifierOption" ADD COLUMN "imageKey" VARCHAR(512);
ALTER TABLE "ModifierGroup" ALTER COLUMN "productId" DROP NOT NULL;
UPDATE "ModifierGroup" g
SET "branchId" = c."branchId"
FROM "Product" p JOIN "CatalogCategory" c ON c.id = p."categoryId"
WHERE g."productId" = p.id;
ALTER TABLE "ModifierGroup" ADD CONSTRAINT "ModifierGroup_branchId_fkey"
FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "ModifierGroup_branchId_sortOrder_idx" ON "ModifierGroup"("branchId", "sortOrder");
CREATE TABLE "ProductModifierGroupAssignment" (
  "productId" UUID NOT NULL,
  "groupId" UUID NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "ProductModifierGroupAssignment_pkey" PRIMARY KEY ("productId","groupId"),
  CONSTRAINT "ProductModifierGroupAssignment_productId_fkey" FOREIGN KEY ("productId")
    REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProductModifierGroupAssignment_groupId_fkey" FOREIGN KEY ("groupId")
    REFERENCES "ModifierGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ProductModifierGroupAssignment_groupId_idx"
  ON "ProductModifierGroupAssignment"("groupId");
INSERT INTO "ProductModifierGroupAssignment" ("productId", "groupId", "sortOrder")
SELECT "productId", id, "sortOrder" FROM "ModifierGroup" WHERE "productId" IS NOT NULL
ON CONFLICT DO NOTHING;
-- ImageKey stays nullable for historical rows; never alter order snapshots.
