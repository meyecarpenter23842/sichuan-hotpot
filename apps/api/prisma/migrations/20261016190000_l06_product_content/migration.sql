-- L06 additive product content fields.
-- Existing products/orders remain unchanged; all new fields are nullable.
ALTER TABLE "Product"
  ADD COLUMN "description" VARCHAR(1200),
  ADD COLUMN "ingredients" VARCHAR(1200),
  ADD COLUMN "productNotes" VARCHAR(800),
  ADD COLUMN "allergenNotice" VARCHAR(800);
