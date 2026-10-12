# P2 customer app — implementation and quality evidence

## Scope on PR #23
- Expo React Native Android + Expo Web PWA customer app, public menu/search,
  product detail with available variants, persisted cart, Google OIDC and
  username/password authentication, draft delivery address and GPS opt-in.
- Public NestJS PostgreSQL-backed `/catalog/branches` and
  `/catalog/branches/:branchId`, no fabricated catalogue.
- Shared cart validation keeps prices out of checkout payloads.
- No live quote/order creation API exists yet. Checkout must stay blocked
  rather than create a phantom order or zero delivery fee.
- The 8 original root PNG designs are SHA-locked and unchanged.

## Test evidence
- Root lint/typecheck/build and 10 cart/catalog tests: PASS in isolated
  sandbox on initial P2 commit.
- Expo app ESLint/typecheck/2 source tests + web export: PASS in isolated
  sandbox. Not a browser/device screenshot acceptance test.
- npm package-lock mismatch: FIXED by one-time branch-only GitHub Actions
  regeneration; npm ci PASS in repair job (run 38263252246).
- Current PR CI must check npm ci, Prisma migration tests, shared/API tests,
  Expo lint/typecheck/tests and web export on exact latest PR HEAD.
- Pixel comparison against original design and Android emulator: NOT TESTED.
- iPhone Safari PWA, GPS and real Google OAuth end-to-end: NOT TESTED.
- Production API integration, saved addresses, route quote, COD/QR checkout,
  idempotent server-side order creation: NOT IMPLEMENTED / NOT TESTED.

## Release constraints
No production API migration/deploy, Vercel release or local F: synchronization.
Keep PR in draft until required CI is green and missing UI/UX evidence is
reviewed. Do not assert a full P2 exit gate merely from a web export.
