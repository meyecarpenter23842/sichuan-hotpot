# Dining-in L01 — database contract & security (Issue #243)

**Status: SCHEMA/CI ONLY. No production migration or POS/QR ordering endpoints.**
UI direction was approved in Issue #242; source design image lives in PR #259.

## Ownership and tenant boundaries
- `DiningArea` is owned by one Branch, `DiningTable` references area *and branch* via composite FK.
- `DiningSession` references table *and branch*, opened/closed by authenticated staff.
- `DiningGuestGrant`, `DiningTicket`, `DiningPayment` and `DiningAuditEvent` link by composite `(sessionId, branchId)` FKs. A ticket can only reference a grant from the **same session and branch**.
- `DiningSession_one_active_per_table_idx` is a manually defined PostgreSQL partial unique index on `tableId WHERE closedAt IS NULL`, independent of HTTP request races. Prisma 6 does **not** represent this index; DO NOT remove it. The `CLOSED` status requires both `closedAt` and `closedById` to be recorded together. A paid table may enter `CHECKOUT` without freeing the table.
- `DiningTable.qrHandle` is a public locator/print value, **never permission to send orders**. Only scoped, expiring `DiningGuestGrant.tokenHash` (SHA-256) is stored. The raw guest token must never appear in logs, database, QR image, or browser analytics. On close/reassign L02 must revoke all grants.
- Adding `WAITER` / `CASHIER` to `Role` does not grant them API privileges automatically. L02 must enforce branch membership/capabilities (OWNER/MANAGER can manage; WAITER can serve/approve if authorized; CASHIER handles payment; KITCHEN only prep; CUSTOMER/DRIVER denied). Authenticated Retail must not rely on frontend-only permissions.

## Ordering and payments contract for L02/L07
- Delivery `Order` remains untouched and keeps customer, address and delivery policy mandatory.
- One dining session may own multiple `DiningTicket` rows. QR tickets always start `PENDING_APPROVAL`; no money is chargeable and no kitchen task should be created until the authorized server approval transaction. Staff tickets use `STAFF` source and an authenticated `createdById`.
- Unique `(sessionId, source, idempotencyKey)` plus `requestHash` protects retries. L02 must compare hash on repeated keys and reject mismatched payloads. Approval and kitchen dispatch must be atomic/idempotent, with outbox if needed.
- `DiningTicketItem` records product/variant names and `selectionSnapshot` with server-calculated variant/modifier/combo values. The DB checks VND amounts, positive quantity and `lineTotalVnd = unitPriceVnd * quantity`. Frontend must never supply trusted prices.
- `DiningPayment` starts `PENDING` for CASH/QR. `CONFIRMED` requires reviewer/time, and QR screenshots alone never confirm receipt. Bill is computed from confirmed eligible tickets, not counted once per ticket.
- `DiningAuditEvent` is a branch-scoped event ledger. L02 must treat it as append-only in authorized service/API code and never expose internal data to guest access. Schema alone does not supply API authorization.

## Migration & deployment
- Migration: `20261021090000_dinein_l01_foundation` (new enums/tables/FKs/indexes, no existing delivery Order changes or data backfills).
- CI validates Prisma, applies full migrations to throwaway PostgreSQL, runs `migrate diff` drift gate, and executes `scripts/qa/dining-db-invariants.mjs` (**hard refuses any non-CI database**). Existing app lint/TS/tests/PWA/Android gates remain.
- On production **STOP** until explicit permission and actual Neon/VPS DB target check. Get encrypted backup and independently verified restore point before applying `migrate deploy`. Test pre- and post-deploy API/auth/delivery/role functionality. Keep migrations forward-compatible; PostgreSQL role enum additions are not trivial to revert. If a migration fails, do not manually remove schema/tables or downcast enums; restore verified backup or use a reviewed forward repair.
- Merge is **not** production migration or deployment. No frontend functionality should be marked delivered by this work.
