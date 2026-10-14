-- P4.1: per-branch weekly opening hours, without synthetic defaults.
-- Applied only through separately approved production migration.
CREATE TABLE "BranchOpeningHour" (
    "branchId" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "opensAt" VARCHAR(5) NOT NULL,
    "closesAt" VARCHAR(5) NOT NULL,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "BranchOpeningHour_pkey" PRIMARY KEY ("branchId","weekday"),
    CONSTRAINT "BranchOpeningHour_weekday_check" CHECK ("weekday" BETWEEN 0 AND 6),
    CONSTRAINT "BranchOpeningHour_times_check" CHECK (
        "opensAt" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        AND "closesAt" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    )
);
ALTER TABLE "BranchOpeningHour" ADD CONSTRAINT "BranchOpeningHour_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
