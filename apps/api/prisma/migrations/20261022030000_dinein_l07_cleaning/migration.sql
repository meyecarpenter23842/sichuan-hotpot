-- L07: closing a dining session marks its physical table awaiting cleaning.
-- Existing tables start clean; no production rows are deleted or rewritten.
ALTER TABLE "DiningTable" ADD COLUMN "needsCleaning" BOOLEAN NOT NULL DEFAULT false;
