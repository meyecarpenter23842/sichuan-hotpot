-- L03 completion: legacy categories remain browseable, newly created categories
-- remain private until R2 HEAD-verified images are attached.
ALTER TABLE "CatalogCategory" ADD COLUMN "isPublished" BOOLEAN NOT NULL DEFAULT TRUE;
