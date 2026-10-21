# L02 Dining API — Issue #244

Status: DEV / CI ONLY. Requires L01 schema. Production migration and deploy are NOT authorized.

## Authentication

Staff: Authorization: Bearer <access-token> (existing JWT session). OWNER may operate across branches, while all others MUST have server-validated BranchMember for the given branch. OWNER/MANAGER have full dining access; WAITER can open, order and approve; CASHIER can read bills and close settled sessions; KITCHEN can read board. DRIVER and CUSTOMER cannot use staff dining endpoints.

Guest: the printed qrHandle is only a public locator, not a credential. POST grant requires an OPEN session; an opaque random 15-minute credential is returned once and SHA-256 is stored in the database. Guest sends Authorization: Dining <credential> as an HTTP header; never store in URL, QR, analytics or logs. Close revokes all grants. Every call rechecks expiry, branch, session and revocation. IP throttling plus transactional limits prevent unlimited issuance and spamming. QR reuse is possible and therefore **staff review is mandatory for every QR ticket**. Existing CORS exact-origin allowlist must include the two PWA domains before release.

## Staff routes

- GET /dining/branches/:branchId/areas — dining staff
- GET /dining/branches/:branchId/tables — dining staff; each row includes active session summary
- POST /dining/branches/:branchId/tables/:tableId/sessions — OWNER/MANAGER/WAITER; optional guestCount 1–100
- GET /dining/branches/:branchId/sessions/:sessionId — OWNER/MANAGER/WAITER/CASHIER; bill and pending tickets
- POST /dining/branches/:branchId/sessions/:sessionId/tickets — OWNER/MANAGER/WAITER; direct staff approval
- POST /dining/branches/:branchId/sessions/:sessionId/transfer — OWNER/MANAGER/WAITER; body { "expectedTableId": "UUID", "targetTableId": "UUID" }. A transfer must match the table currently owning the session and a free target table in the same branch. Old QR grants are revoked; pending QR requests are rejected with audit; new QR issues credentials for the destination. Concurrent transfers cannot reassign a stale table.
- PUT /dining/branches/:branchId/tickets/:ticketId/items — OWNER/MANAGER/WAITER; changes **pending QR only**. Body { "expectedUpdatedAt": "ISO-8601 timestamp", "customerNote": "optional note", "items": [same ticket items as above] }. Changes are fully repriced using authoritative catalog and audited; an outdated timestamp, already reviewed ticket or closed session is rejected. Previously approved kitchen work cannot be silently edited.
- GET /dining/branches/:branchId/approvals — OWNER/MANAGER/WAITER; pending QR only
- POST /dining/branches/:branchId/tickets/:ticketId/approve — OWNER/MANAGER/WAITER
- POST /dining/branches/:branchId/tickets/:ticketId/reject — OWNER/MANAGER/WAITER; reason required 3–500 chars
- GET /dining/branches/:branchId/kitchen — OWNER/MANAGER/WAITER/KITCHEN; approved tickets only
- POST /dining/branches/:branchId/sessions/:sessionId/close — OWNER/MANAGER/CASHIER; blocks unpaid approved bills

## QR routes

- GET /dining/qr/:qrHandle — PUBLIC; locator only (branch name, table/area; no active session ID)
- POST /dining/qr/:qrHandle/grants — PUBLIC; requires open table; issues scoped credential
- POST /dining/guest/tickets — guest credential; submits pending ticket
- GET /dining/guest/tickets — guest credential; tickets from own grant only
- GET /dining/guest/bill — guest credential; approved eligible items only

For menu browsing, existing public catalog branch menu is reused. No User, delivery Order or delivery Address is created.

## Ticket payload

JSON body:
~~~json
{
  "idempotencyKey": "random-unique-client-key-001",
  "customerNote": "Ít cay",
  "items": [{
    "productId": "uuid-v4",
    "variantId": null,
    "modifierIds": [],
    "comboOptionIds": [],
    "quantity": 1,
    "note": "Không hành"
  }]
}
~~~

Quantity 1–99, cart 1–100 lines, each selection array up to 30 IDs. Client price fields, delivery address, branch and payment fields are **rejected** by the NestJS global whitelist. Server reuses existing catalog priceCart within Serializable DB transaction; product/variant/modifier/combo availability and prices are authoritative. L02 supports legacy per-unit pricing so the L01 database invariant lineTotalVnd = unitPriceVnd * quantity is always met. Modifier and combo selection snapshots are persisted per item.

QR status PENDING_APPROVAL is not chargeable and does not appear in kitchen. Staff ticket starts APPROVED. Approval changes the existing ticket once, transactionally, with an append-only dining audit. Ticket ID is the durable kitchen work-item identity, not a copy or a delivery Order. Future L06 push/WebSocket dispatch must de-duplicate by this ID and observe committed rows.

Idempotency key is scoped to (sessionId, source, idempotencyKey) plus requestHash and actor. Identical retry returns replayed true. Same key with changed body or different actor gives conflict. Concurrent actions use PostgreSQL SERIALIZABLE transactions and retry; the database maintains the one-active-session-per-table partial unique index. Close revokes all active guest grants and rejects outstanding pending QR tickets in one transaction. Close requires that confirmed payments cover eligible ticket charges (payment confirmation implementation belongs to L07).

## HTTP errors

404: DINING_QR_NOT_FOUND, DINING_TABLE_UNAVAILABLE, DINING_SESSION_NOT_FOUND, DINING_TICKET_NOT_FOUND.
403: DINING_BRANCH_FORBIDDEN, DINING_ROLE_FORBIDDEN.
401: DINING_GUEST_AUTH_REQUIRED, DINING_GUEST_EXPIRED.
409: DINING_TABLE_OCCUPIED, DINING_SESSION_NOT_OPEN, DINING_BILL_UNPAID, DINING_IDEMPOTENCY_REUSED, DINING_TICKET_ALREADY_REVIEWED, DINING_TICKET_STALE, DINING_TABLE_MOVED, DINING_SESSION_MOVED, DINING_CONCURRENT_RETRY, DINING_TICKET_RATE_LIMIT, DINING_GUEST_GRANT_LIMIT.
400: DINING_REJECTION_REASON_REQUIRED, DINING_GUEST_COUNT_INVALID, INVALID_DINING_NOTE.
422: PRODUCT_UNAVAILABLE, VARIANT_UNAVAILABLE, INVALID_MODIFIERS, INVALID_COMBO_SELECTION.
Use the common API exception envelope and map codes to user-friendly messages.

## Acceptance on throwaway CI Postgres

- Full schema migration / drift gate, L01 DB checks, lint, typecheck, unit, build, PWA and browser regression.
- L02 dedicated script: role and branch isolation, concurrent open, staff/QR retry, duplicate idempotency key conflict, server variant+topping+combo price, item shortage, QR pending absent from bill/kitchen, concurrent approve produces one kitchen ticket, pending QR edit with optimistic timestamp and server repricing, stale move/occupied table transfer, reject terminal, unpaid-close gate, grant revocation, close vs submit race. Kitchen role must not receive price or bill details.
- Check delivery Order count stays zero.

Scope exclusions: UI/admin table creation (L03–L05), realtime and sounds (L06), payment API (L07). Merge is NOT deploy. Before production migration, verify DB target (VPS or Neon), backup/restore, and receive explicit approval.
