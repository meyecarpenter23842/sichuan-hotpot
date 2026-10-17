-- Additive notification endpoint storage. No existing order/customer data is modified.
CREATE TYPE "PushScope" AS ENUM ('CUSTOMER', 'STAFF');
CREATE TYPE "PushTransport" AS ENUM ('WEB_PUSH', 'FCM');

CREATE TABLE "PushEndpoint" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "branchId" UUID,
  "scope" "PushScope" NOT NULL,
  "transport" "PushTransport" NOT NULL,
  "token" TEXT NOT NULL,
  "p256dh" VARCHAR(256),
  "auth" VARCHAR(128),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "PushEndpoint_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PushEndpoint_token_key" ON "PushEndpoint"("token");
CREATE INDEX "PushEndpoint_userId_scope_idx" ON "PushEndpoint"("userId", "scope");
CREATE INDEX "PushEndpoint_branchId_scope_idx" ON "PushEndpoint"("branchId", "scope");

ALTER TABLE "PushEndpoint"
  ADD CONSTRAINT "PushEndpoint_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PushEndpoint"
  ADD CONSTRAINT "PushEndpoint_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
