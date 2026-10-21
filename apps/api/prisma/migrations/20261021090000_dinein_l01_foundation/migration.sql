-- #243 Dine-in L01: additive branch-scoped tables only. No delivery order
-- rows or production data are altered. Never use fake customer/address rows.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'WAITER';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'CASHIER';

CREATE TYPE "DiningSessionStatus" AS ENUM ('OPEN', 'CHECKOUT', 'CLOSED');
CREATE TYPE "DiningTicketSource" AS ENUM ('STAFF', 'QR');
CREATE TYPE "DiningTicketStatus" AS ENUM
  ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PREPARING', 'READY', 'SERVED', 'CANCELED');
CREATE TYPE "DiningPaymentMethod" AS ENUM ('CASH', 'QR');
CREATE TYPE "DiningPaymentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'VOIDED', 'REFUNDED');

CREATE TABLE "DiningArea" (
  "id" UUID NOT NULL,
  "branchId" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "DiningArea_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DiningArea_name_not_blank_check" CHECK (length(btrim("name")) > 0)
);

CREATE UNIQUE INDEX "DiningArea_id_branchId_key" ON "DiningArea"("id", "branchId");
CREATE UNIQUE INDEX "DiningArea_branchId_name_key" ON "DiningArea"("branchId", "name");
CREATE INDEX "DiningArea_branchId_sortOrder_idx" ON "DiningArea"("branchId", "sortOrder");

CREATE TABLE "DiningTable" (
  "id" UUID NOT NULL,
  "branchId" UUID NOT NULL,
  "areaId" UUID NOT NULL,
  "code" VARCHAR(40) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "qrHandle" VARCHAR(64) NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "DiningTable_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DiningTable_code_not_blank_check" CHECK (length(btrim("code")) > 0),
  CONSTRAINT "DiningTable_name_not_blank_check" CHECK (length(btrim("name")) > 0),
  -- The QR printed on the table is a public locator, not an authorization token.
  CONSTRAINT "DiningTable_qrHandle_length_check" CHECK (length("qrHandle") >= 16)
);
CREATE UNIQUE INDEX "DiningTable_qrHandle_key" ON "DiningTable"("qrHandle");
CREATE UNIQUE INDEX "DiningTable_id_branchId_key" ON "DiningTable"("id", "branchId");
CREATE UNIQUE INDEX "DiningTable_branchId_code_key" ON "DiningTable"("branchId", "code");
CREATE INDEX "DiningTable_branchId_areaId_sortOrder_idx" ON "DiningTable"("branchId", "areaId", "sortOrder");

CREATE TABLE "DiningSession" (
  "id" UUID NOT NULL,
  "branchId" UUID NOT NULL,
  "tableId" UUID NOT NULL,
  "status" "DiningSessionStatus" NOT NULL DEFAULT 'OPEN',
  "guestCount" INTEGER,
  "openedById" UUID NOT NULL,
  "closedById" UUID,
  "openedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMPTZ(6),
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "DiningSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DiningSession_guestCount_check" CHECK ("guestCount" IS NULL OR ("guestCount" > 0 AND "guestCount" <= 100)),
  CONSTRAINT "DiningSession_status_close_check" CHECK (
    ("status" = 'CLOSED' AND "closedAt" IS NOT NULL AND "closedById" IS NOT NULL)
    OR
    ("status" <> 'CLOSED' AND "closedAt" IS NULL AND "closedById" IS NULL)
  ),
  CONSTRAINT "DiningSession_closed_after_open_check" CHECK ("closedAt" IS NULL OR "closedAt" >= "openedAt")
);
CREATE UNIQUE INDEX "DiningSession_id_branchId_key" ON "DiningSession"("id", "branchId");
CREATE INDEX "DiningSession_branchId_status_openedAt_idx" ON "DiningSession"("branchId", "status", "openedAt");
CREATE INDEX "DiningSession_tableId_closedAt_idx" ON "DiningSession"("tableId", "closedAt");
-- Critical DB invariant, intentionally not represented in Prisma 6 schema:
-- independent of backend retries, only one *active* session per physical table.
CREATE UNIQUE INDEX "DiningSession_one_active_per_table_idx"
  ON "DiningSession"("tableId") WHERE "closedAt" IS NULL;

CREATE TABLE "DiningGuestGrant" (
  "id" UUID NOT NULL,
  "branchId" UUID NOT NULL,
  "sessionId" UUID NOT NULL,
  "tokenHash" VARCHAR(64) NOT NULL,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "revokedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DiningGuestGrant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DiningGuestGrant_hash_check" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "DiningGuestGrant_expiry_check" CHECK ("expiresAt" > "createdAt")
);
CREATE UNIQUE INDEX "DiningGuestGrant_tokenHash_key" ON "DiningGuestGrant"("tokenHash");
CREATE UNIQUE INDEX "DiningGuestGrant_id_sessionId_branchId_key" ON "DiningGuestGrant"("id", "sessionId", "branchId");
CREATE INDEX "DiningGuestGrant_sessionId_expiresAt_idx" ON "DiningGuestGrant"("sessionId", "expiresAt");

CREATE TABLE "DiningTicket" (
  "id" UUID NOT NULL,
  "branchId" UUID NOT NULL,
  "sessionId" UUID NOT NULL,
  "guestGrantId" UUID,
  "createdById" UUID,
  "reviewedById" UUID,
  "source" "DiningTicketSource" NOT NULL,
  "status" "DiningTicketStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
  "idempotencyKey" VARCHAR(128) NOT NULL,
  "requestHash" VARCHAR(64) NOT NULL,
  "customerNote" VARCHAR(500),
  "rejectionReason" VARCHAR(500),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMPTZ(6),
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "DiningTicket_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DiningTicket_hash_check" CHECK ("requestHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "DiningTicket_idempotency_check" CHECK (length(btrim("idempotencyKey")) > 0),
  CONSTRAINT "DiningTicket_actor_source_check" CHECK (
    ("source" = 'QR' AND "guestGrantId" IS NOT NULL AND "createdById" IS NULL)
    OR
    ("source" = 'STAFF' AND "guestGrantId" IS NULL AND "createdById" IS NOT NULL)
  ),
  CONSTRAINT "DiningTicket_review_check" CHECK (
    ("reviewedAt" IS NULL AND "reviewedById" IS NULL)
    OR ("reviewedAt" IS NOT NULL AND "reviewedById" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "DiningTicket_sessionId_source_idempotencyKey_key"
  ON "DiningTicket"("sessionId", "source", "idempotencyKey");
CREATE INDEX "DiningTicket_branchId_status_createdAt_idx" ON "DiningTicket"("branchId", "status", "createdAt");
CREATE INDEX "DiningTicket_sessionId_createdAt_idx" ON "DiningTicket"("sessionId", "createdAt");
CREATE INDEX "DiningTicket_guestGrantId_idx" ON "DiningTicket"("guestGrantId");

CREATE TABLE "DiningTicketItem" (
  "id" UUID NOT NULL,
  "ticketId" UUID NOT NULL,
  "productId" UUID,
  "variantId" UUID,
  "productName" VARCHAR(200) NOT NULL,
  "variantName" VARCHAR(160),
  "selectionSnapshot" JSONB NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unitPriceVnd" INTEGER NOT NULL,
  "lineTotalVnd" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DiningTicketItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DiningTicketItem_quantity_check" CHECK ("quantity" > 0 AND "quantity" <= 100),
  CONSTRAINT "DiningTicketItem_money_check" CHECK (
    "unitPriceVnd" >= 0 AND "lineTotalVnd" >= 0
    AND "lineTotalVnd"::BIGINT = "quantity"::BIGINT * "unitPriceVnd"::BIGINT
  ),
  CONSTRAINT "DiningTicketItem_selection_json_check" CHECK (jsonb_typeof("selectionSnapshot") = 'object')
);
CREATE INDEX "DiningTicketItem_ticketId_idx" ON "DiningTicketItem"("ticketId");
CREATE INDEX "DiningTicketItem_productId_idx" ON "DiningTicketItem"("productId");
CREATE INDEX "DiningTicketItem_variantId_idx" ON "DiningTicketItem"("variantId");

CREATE TABLE "DiningPayment" (
  "id" UUID NOT NULL,
  "branchId" UUID NOT NULL,
  "sessionId" UUID NOT NULL,
  "method" "DiningPaymentMethod" NOT NULL,
  "status" "DiningPaymentStatus" NOT NULL DEFAULT 'PENDING',
  "amountVnd" INTEGER NOT NULL,
  "idempotencyKey" VARCHAR(128) NOT NULL,
  "recordedById" UUID NOT NULL,
  "confirmedById" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedAt" TIMESTAMPTZ(6),
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "DiningPayment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DiningPayment_amount_check" CHECK ("amountVnd" > 0),
  CONSTRAINT "DiningPayment_idempotency_check" CHECK (length(btrim("idempotencyKey")) > 0),
  CONSTRAINT "DiningPayment_confirmation_check" CHECK (
    ("status" = 'CONFIRMED' AND "confirmedAt" IS NOT NULL AND "confirmedById" IS NOT NULL)
    OR ("status" <> 'CONFIRMED')
  )
);
CREATE UNIQUE INDEX "DiningPayment_sessionId_idempotencyKey_key"
  ON "DiningPayment"("sessionId", "idempotencyKey");
CREATE INDEX "DiningPayment_branchId_status_createdAt_idx"
  ON "DiningPayment"("branchId", "status", "createdAt");
CREATE INDEX "DiningPayment_sessionId_createdAt_idx" ON "DiningPayment"("sessionId", "createdAt");

CREATE TABLE "DiningAuditEvent" (
  "id" UUID NOT NULL,
  "branchId" UUID NOT NULL,
  "sessionId" UUID NOT NULL,
  "actorId" UUID,
  "action" VARCHAR(64) NOT NULL,
  "details" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DiningAuditEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DiningAuditEvent_action_check" CHECK (length(btrim("action")) > 0),
  CONSTRAINT "DiningAuditEvent_details_check" CHECK (jsonb_typeof("details") = 'object')
);
CREATE INDEX "DiningAuditEvent_branchId_createdAt_idx" ON "DiningAuditEvent"("branchId", "createdAt");
CREATE INDEX "DiningAuditEvent_sessionId_createdAt_idx" ON "DiningAuditEvent"("sessionId", "createdAt");

-- Composite foreign keys are the actual tenant isolation guarantee. A caller
-- cannot attach a table, ticket, grant or payment to another branch by ID.
ALTER TABLE "DiningArea" ADD CONSTRAINT "DiningArea_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiningTable" ADD CONSTRAINT "DiningTable_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiningTable" ADD CONSTRAINT "DiningTable_areaId_branchId_fkey"
  FOREIGN KEY ("areaId","branchId") REFERENCES "DiningArea"("id","branchId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiningSession" ADD CONSTRAINT "DiningSession_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiningSession" ADD CONSTRAINT "DiningSession_tableId_branchId_fkey"
  FOREIGN KEY ("tableId","branchId") REFERENCES "DiningTable"("id","branchId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiningSession" ADD CONSTRAINT "DiningSession_openedById_fkey"
  FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiningSession" ADD CONSTRAINT "DiningSession_closedById_fkey"
  FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DiningGuestGrant" ADD CONSTRAINT "DiningGuestGrant_sessionId_branchId_fkey"
  FOREIGN KEY ("sessionId","branchId") REFERENCES "DiningSession"("id","branchId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiningTicket" ADD CONSTRAINT "DiningTicket_sessionId_branchId_fkey"
  FOREIGN KEY ("sessionId","branchId") REFERENCES "DiningSession"("id","branchId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiningTicket" ADD CONSTRAINT "DiningTicket_guestGrantId_sessionId_branchId_fkey"
  FOREIGN KEY ("guestGrantId","sessionId","branchId")
  REFERENCES "DiningGuestGrant"("id","sessionId","branchId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiningTicket" ADD CONSTRAINT "DiningTicket_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiningTicket" ADD CONSTRAINT "DiningTicket_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiningTicketItem" ADD CONSTRAINT "DiningTicketItem_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "DiningTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiningTicketItem" ADD CONSTRAINT "DiningTicketItem_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DiningTicketItem" ADD CONSTRAINT "DiningTicketItem_variantId_fkey"
  FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DiningPayment" ADD CONSTRAINT "DiningPayment_sessionId_branchId_fkey"
  FOREIGN KEY ("sessionId","branchId") REFERENCES "DiningSession"("id","branchId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiningPayment" ADD CONSTRAINT "DiningPayment_recordedById_fkey"
  FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiningPayment" ADD CONSTRAINT "DiningPayment_confirmedById_fkey"
  FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiningAuditEvent" ADD CONSTRAINT "DiningAuditEvent_sessionId_branchId_fkey"
  FOREIGN KEY ("sessionId","branchId") REFERENCES "DiningSession"("id","branchId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiningAuditEvent" ADD CONSTRAINT "DiningAuditEvent_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
