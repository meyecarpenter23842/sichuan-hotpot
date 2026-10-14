-- Existing branches may not have a verified street address; do not fabricate one.
ALTER TABLE "Branch" ADD COLUMN "address" VARCHAR(500);
