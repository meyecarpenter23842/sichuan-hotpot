# P3 routing and delivery-quote implementation — partial gate

This PR implements **P3.1 / P3.3 backend quote only**. Checkout, payment,
versioned OWNER policy edits, customer map pin UI, order history and app icons
are still out of scope/not complete. Do not describe P3 as finished.

## Contract

- POST /customer/delivery/quote, Bearer customer access token, JSON:
  {"branchId":"uuid","addressId":"uuid","items":[{"productId":"uuid","variantId":null,"modifierIds":[],"quantity":1}]}
- Response: branchId, addressId, policyVersionId, routeDistanceMeters,
  subtotalVnd, feeVnd, extraSteps, totalVnd, freeDeliveryApplied,
  quoteExpiresAt (UTC ISO, 120s). All prices, modifier limits,
  address ownership and applicable delivery policy are read from PostgreSQL.
  The endpoint accepts **no** client-supplied price or distance.
- Fail closed with 422 error code for policy/fee boundaries
  (OUT_OF_RANGE, STORE_CLOSED, BELOW_MINIMUM, etc.), 503 for missing
  Google Routes API key, network failure or no route. Quotes are previews:
  final checkout **must** recompute price, routing and current policy.
  A quote is not a payment or an order.
- Backend-only environment value GOOGLE_ROUTES_API_KEY must be configured
  separately. Enable Google Routes API and constrain credentials appropriately.
  No default public routing service is used. No API key belongs in Expo,
  GitHub commits, screenshots or public env files.
- Google Routes distance is driving-route meters; 4s timeout per attempt,
  max two attempts, 2-minute in-process success cache with in-flight
  deduplication. No geodesic fallback.
- Cross-origin customer PWA is governed by existing CORS allowlist.
- No Prisma schema changes or production operations in this PR.

## QA status

- CI unit tests: pending workflow result (do not assert PASS until observed).
- Android device / iPhone Safari / routing provider live key: NOT TESTED.
- Required P3 exit criteria (checkout/duplicate idempotency): NOT TESTED.
