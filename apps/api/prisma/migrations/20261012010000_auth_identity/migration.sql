-- P1.3 additive DEV-only migration: preserve all users and prior Clerk references.
-- Existing legacy clerkSubject becomes nullable; no production data is changed.
ALTER TABLE "User" ALTER COLUMN "clerkSubject" DROP NOT NULL;

CREATE TYPE "AuthProvider" AS ENUM ('GOOGLE');

CREATE TABLE "AuthIdentity" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "provider" "AuthProvider" NOT NULL,
    "providerSubject" VARCHAR(255) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuthIdentity_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AuthIdentity_provider_providerSubject_key" ON "AuthIdentity"("provider","providerSubject");
CREATE INDEX "AuthIdentity_userId_idx" ON "AuthIdentity"("userId");
ALTER TABLE "AuthIdentity" ADD CONSTRAINT "AuthIdentity_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "LocalCredential" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "normalizedUsername" VARCHAR(32) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "LocalCredential_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LocalCredential_userId_key" ON "LocalCredential"("userId");
CREATE UNIQUE INDEX "LocalCredential_normalizedUsername_key" ON "LocalCredential"("normalizedUsername");
ALTER TABLE "LocalCredential" ADD CONSTRAINT "LocalCredential_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "AuthSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "refreshTokenHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AuthSession_refreshTokenHash_key" ON "AuthSession"("refreshTokenHash");
CREATE INDEX "AuthSession_userId_expiresAt_idx" ON "AuthSession"("userId","expiresAt");
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
