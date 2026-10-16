-- L05 additive migration: branch-scoped Home hero configuration and slides.
-- No existing order, product, offer, or price rows are changed.
CREATE TABLE "HomeHeroConfig" (
  "branchId" UUID NOT NULL,
  "autoplay" BOOLEAN NOT NULL DEFAULT true,
  "dwellMs" INTEGER NOT NULL DEFAULT 5000,
  "transitionType" VARCHAR(16) NOT NULL DEFAULT 'fade',
  "transitionDurationMs" INTEGER NOT NULL DEFAULT 450,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "HomeHeroConfig_pkey" PRIMARY KEY ("branchId"),
  CONSTRAINT "HomeHeroConfig_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "HomeHeroConfig_dwell_range" CHECK ("dwellMs" BETWEEN 2000 AND 10000),
  CONSTRAINT "HomeHeroConfig_transition_duration_range" CHECK ("transitionDurationMs" BETWEEN 250 AND 1000),
  CONSTRAINT "HomeHeroConfig_transition_type" CHECK ("transitionType" IN ('fade','slide','wipe'))
);

CREATE TABLE "HomeHeroSlide" (
  "id" UUID NOT NULL,
  "branchId" UUID NOT NULL,
  "imageKey" VARCHAR(512),
  "altText" VARCHAR(200) NOT NULL,
  "title" VARCHAR(160),
  "subtitle" VARCHAR(280),
  "ctaTarget" VARCHAR(16),
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "HomeHeroSlide_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HomeHeroSlide_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "HomeHeroSlide_cta_target" CHECK ("ctaTarget" IS NULL OR "ctaTarget" = 'MENU')
);

CREATE INDEX "HomeHeroSlide_branchId_enabled_sortOrder_idx"
  ON "HomeHeroSlide" ("branchId", "enabled", "sortOrder");
