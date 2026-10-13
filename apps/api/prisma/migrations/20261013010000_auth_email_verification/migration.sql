-- Additive authentication migration; production requires verified backup+restore first.
ALTER TABLE "LocalCredential" ADD COLUMN "verifiedEmail" VARCHAR(254);
CREATE UNIQUE INDEX "LocalCredential_verifiedEmail_key" ON "LocalCredential"("verifiedEmail");
CREATE TYPE "EmailChallengePurpose" AS ENUM ('REGISTER', 'RESET_PASSWORD');
CREATE TABLE "EmailChallenge" (
  "id" UUID NOT NULL,
  "email" VARCHAR(254) NOT NULL,
  "purpose" "EmailChallengePurpose" NOT NULL,
  "codeHash" VARCHAR(64) NOT NULL,
  "normalizedUsername" VARCHAR(32),
  "pendingPasswordHash" VARCHAR(255),
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  "usedAt" TIMESTAMPTZ(6),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "EmailChallenge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EmailChallenge_attempt_bounds_check" CHECK ("attempts" >= 0 AND "attempts" <= 5)
);
CREATE UNIQUE INDEX "EmailChallenge_email_purpose_key" ON "EmailChallenge"("email","purpose");
CREATE INDEX "EmailChallenge_expiresAt_idx" ON "EmailChallenge"("expiresAt");
