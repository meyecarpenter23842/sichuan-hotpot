# P3 transactional checkout: manual QA and release boundaries

## API
- POST /customer/orders with Bearer customer JWT, body:
  {"branchId":"uuid","addressId":"uuid","idempotencyKey":"uuid-v4",
   "paymentMethod":"COD","items":[{"productId":"uuid","variantId":null,
   "modifierIds":[],"quantity":1}]}
- GET /customer/orders — last 50 own orders, newest first
- GET /customer/orders/:orderId — own line-item snapshots, payment and status history
- COD and QR orders enter PENDING payment state. Displaying a QR/screenshot
  does NOT confirm bank transfer. No automatic QR reconciliation exists.
- New orders must provide verified session and saved address/phone.
  Server fetches fresh product, variant, topping, branch and policy prices.
  No client-supplied amount/distance is accepted.
- A single database SERIALIZABLE transaction persists order,
  price and delivery policy snapshots, payment and PENDING history.
  The unique (customerId,idempotencyKey) constraint and SHA-256 request
  fingerprint prevent duplicate orders and reject key reuse with changed
  payload. P2002/P2034 retry paths are handled.
- Every NEW order requests a fresh quote backed by road routing; if Google
  Routes is unconfigured/unavailable, creation fails with no payment/order.
  Returning an existing key is safe and does not re-charge or reroute.

## Schema and release
- DEV/CI migration adds nullable requestHash and phoneSnapshot columns
  to existing Order; existing records are preserved.
- No production migration or backend/frontend deployment authorized.
  Production enablement requires owner-approved backup/restore gate,
  reviewed migration and manual release procedure.
- CI includes a real PostgreSQL concurrency test with six simultaneous
  identical requests and verifies exactly one order/payment/history row.
- Owner acceptance of customer checkout UI, QR account configuration,
  Android/iPhone navigation, order tracking and reorder are NOT TESTED.
