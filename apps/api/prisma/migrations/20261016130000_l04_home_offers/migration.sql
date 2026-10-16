-- L04 additive migration. No existing order, product or price rows are changed.
CREATE TABLE "HomeOffer" (
  "id" UUID NOT NULL,
  "branchId" UUID NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "summary" VARCHAR(360) NOT NULL,
  "body" VARCHAR(4000) NOT NULL,
  "imageKey" VARCHAR(512),
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "startAt" TIMESTAMPTZ(6),
  "endAt" TIMESTAMPTZ(6),
  "ctaTarget" VARCHAR(16),
  "revision" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "HomeOffer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HomeOffer_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "HomeOffer_active_interval" CHECK ("startAt" IS NULL OR "endAt" IS NULL OR "startAt" < "endAt"),
  CONSTRAINT "HomeOffer_cta_target" CHECK ("ctaTarget" IS NULL OR "ctaTarget" = 'MENU')
);
CREATE INDEX "HomeOffer_branchId_enabled_sortOrder_idx" ON "HomeOffer" ("branchId", "enabled", "sortOrder");
CREATE INDEX "HomeOffer_branchId_startAt_endAt_idx" ON "HomeOffer" ("branchId", "startAt", "endAt");
