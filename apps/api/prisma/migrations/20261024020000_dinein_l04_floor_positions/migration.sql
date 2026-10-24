-- L04 floor plan: nullable presentation coordinates only, never business state.
-- Existing tables remain unplaced and retain their current area/session/QR.
ALTER TABLE "DiningTable"
  ADD COLUMN "floorRow" INTEGER,
  ADD COLUMN "floorColumn" INTEGER;

ALTER TABLE "DiningTable"
  ADD CONSTRAINT "DiningTable_floor_pair_and_bounds_check"
  CHECK (
    ("floorRow" IS NULL AND "floorColumn" IS NULL)
    OR ("floorRow" BETWEEN 0 AND 19 AND "floorColumn" BETWEEN 0 AND 5)
  );

-- One physical slot may be occupied by only one table in the same branch/area.
CREATE UNIQUE INDEX "DiningTable_floor_slot_unique_idx"
  ON "DiningTable" ("branchId", "areaId", "floorRow", "floorColumn")
  WHERE "floorRow" IS NOT NULL;
