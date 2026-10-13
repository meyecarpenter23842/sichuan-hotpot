# P3 — Customer checkout and order history UI

Scope: customer-only Expo React Native/Expo Web PWA. No Home restyle,
no Admin UI, no automatic deploy.

- Cart uses selected, account-owned saved address ID; a local GPS draft alone
  cannot be submitted until saved to the authenticated account.
- Checkout requests real road-based server quote before placing an order.
  The quote is invalidated by changes to cart/branch/address; it expires
  and the API always recalculates during checkout.
- In-process synchronous button lock prevents repeated taps.
  Pending UUID idempotency key is stored with request fingerprint before
  network POST and reused after network timeout/app restart. A conflicting
  unsolved intent blocks a new different order until reviewed rather than
  silently issuing another order.
- Successful POST clears cart only after a server order response. COD and
  QR responses are *orders awaiting payment reconciliation*, never proof of
  money received. Actual merchant QR code/details have not been configured.
- Own order history and timeline use authenticated server endpoints; reload
  reads current server status rather than treating push notifications as
  authoritative. Reorder requires live matching product/variant/modifier
  combinations and recalculates using current prices.

QA: Build, lint, types, source tests, browser QA run via PR CI. Record actual
results after checks. Android device & iPhone Safari remain NOT TESTED.
No live Google Routes key or production checkout has been tested.
