# P2.2 customer catalogue, modifiers, cart and addresses QA

Implementation on PR #27 follows the eight locked customer/admin source PNGs and the
[professional-frontend-qa](../../.agents/skills/professional-frontend-qa/SKILL.md) skill.
The approved login references remain untouched.

## Scope
- Guest: live NestJS/PostgreSQL store list, categories, search, variants and products.
- Product modifier groups from DB: required min/max, available-only, price delta shown
  for estimate, cart line identity by variant + sorted option IDs (no client prices).
- Optional product `imageKey` maps only to public R2 `products-image/` paths.
  Images are absent until owner/admin uploads and assigns real media.
- Cart survives app reload on-device; item quantity limited to 99; P3 checkout intentionally
  disabled until backend route quote/idempotent order create available.
- Signed-in CUSTOMER: list/create/delete **own** address and persist account phone,
  up to ten saved entries, GPS opt-in / validated manual coordinates / map verification.
  Guest: only local draft, no implied backend sync.
- DB changes are additive on disposable CI Postgres only; no production release.

## Evidence and outstanding
- Root check-source, Prisma migrations, strict TypeScript, tests, customer ESLint and
  Expo Web export: GitHub Actions for latest PR HEAD determines PASS/FAIL.
- Chromium P2.2 test with disposable PostgreSQL fixture in
  `scripts/qa/p22-catalog-browser-qa.mjs` tests real menu/cart/option/addresses flows,
  and captures screenshots to the workflow's `customer-browser-qa-screenshots` artifact.
  Do not mark PASS before CI actually completes.
- **NOT TESTED**: Android emulator native screen, iPhone Safari installed PWA,
  manual reference-image pixel match, real R2 product media upload/selection,
  production HTTPS / real GPS permission on physical phones and production release.
- **OUT OF SCOPE** P3 real driving distance/fee, COD/QR and order placement.

No production migration, backend/frontend deploy, local F: sync or fabricated orders.
