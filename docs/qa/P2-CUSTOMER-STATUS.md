# P2 customer implementation — initial backend/cart slice

Scope: public PostgreSQL-backed catalogue and deterministic, price-free cart model.
Reference visual sources are the eight unchanged root PNGs. Frontend UI itself is not
implemented by this slice. This document must not be mistaken for visual QA approval.

## Endpoints
- GET /catalog/branches: anonymous active branch IDs, names and codes.
- GET /catalog/branches/:branchId: anonymous active branch, ordered categories,
  available/unavailable products and variant IDs/price deltas.
- Invalid branch UUID => 400; inactive or nonexistent branch => 404.
- Database unavailable => error; no placeholder products or fake 0 VND shipping.

## Cart business invariants
- Stable line identity independent of modifier ordering.
- Quantity limits 1..99; 0 removes a line; no mutable shared state.
- No client-supplied price/fee/total ever enters the future checkout payload.
- Product availability, all prices, modifier validity and stock must be rechecked
  by the backend when implementing P3 order creation.
- Backend is still not deployed/migrated to production.

## QA evidence
- Shared cart unit tests and Nest service tests added.
- Android emulator, iPhone Safari, screenshots vs all eight PNGs: NOT TESTED
  (no app UI shipped by this slice).
- GPS, Google mobile OAuth and safe idempotent checkout: NOT IMPLEMENTED in this slice.
