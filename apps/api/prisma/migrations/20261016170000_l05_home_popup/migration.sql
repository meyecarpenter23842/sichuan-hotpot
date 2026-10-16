-- L05 follow-up: configurable branch-scoped promotional popup.
-- Additive only; no order, product, price, offer, or existing hero rows are modified.
CREATE TABLE "HomePopupConfig" (
  "branchId" UUID NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "repeatIntervalMinutes" INTEGER NOT NULL DEFAULT 360,
  "slideDwellMs" INTEGER NOT NULL DEFAULT 4000,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "HomePopupConfig_pkey" PRIMARY KEY ("branchId"),
  CONSTRAINT "HomePopupConfig_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "HomePopupConfig_repeat_range" CHECK ("repeatIntervalMinutes" BETWEEN 5 AND 10080),
  CONSTRAINT "HomePopupConfig_dwell_range" CHECK ("slideDwellMs" BETWEEN 2000 AND 10000)
);

CREATE TABLE "HomePopupSlide" (
  "id" UUID NOT NULL,
  "branchId" UUID NOT NULL,
  "imageKey" VARCHAR(512),
  "altText" VARCHAR(200) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "HomePopupSlide_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HomePopupSlide_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "HomePopupSlide_branchId_enabled_sortOrder_idx"
  ON "HomePopupSlide" ("branchId", "enabled", "sortOrder");
