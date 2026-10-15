-- P4.5/L06: branch-scoped featured products and durable product ordering.
-- Production requires a verified backup and separately approved migration.
ALTER TABLE "Branch" ADD COLUMN "catalogRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN "isFeatured" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "Product_categoryId_sortOrder_idx" ON "Product"("categoryId", "sortOrder");
CREATE INDEX "Product_isFeatured_idx" ON "Product"("isFeatured");
