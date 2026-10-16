# L04 — Ưu đãi hôm nay (Issue #131)

## Contract

- `HomeOffer` belongs to exactly one branch; nothing in `Order` or product pricing changes.
- All offer management routes are restricted to OWNER on the server. Public `GET /catalog/branches/:branchId/offers` is guest-accessible and filters enabled, image-present, start <= server UTC time and end > server UTC time.
- UTC intervals, null means unbounded. Display and enter times in Vietnam UTC+07, converted explicitly to/from UTC; time does not depend on device timezone.
- Admin stores a draft first, attaches an image through scoped R2 PUT ticket + HEAD verification, and then enables publication. Content, disable, revision and sorting are persisted, never cosmetic-only toggles.
- Each uploaded key belongs to `catalog-media/{branchId}/offers/{offerId}/{uuid}.{ext}`. Wrong branch/offer/key, content-type, file-size, expired ticket or missing R2 object are rejected. Replaced and deleted keys are queued for asynchronous R2 cleanup after DB commit. Failed R2 cleanup never breaks the order flow.
- CTA is an internal `MENU` route only; no arbitrary off-site links or HTML are rendered. Offers NEVER apply automatic discounts or alter checkout totals.

## Safe database migration

`20261016130000_l04_home_offers` adds one new table, unique primary key, FK and indexes only. It never touches historical orders or catalogue data. CI migration must run on disposable Postgres and validate restoration. Before any production migration: backup existing DB and rehearse restore to separate DB. If deployment fails, leave additive table intact and roll back application binaries, **not** destructive DROP TABLE on production. Run the approved manual API release only with owner permission.

## QA to close

1. OWNER creates an offer in Admin Settings (title, summary, body, start/end); verify draft is invisible to customers.
2. Upload image in R2; invalid MIME/size/cross-branch key is denied; attach success visible after reload. Turn on offer, verify client guest sees matching branch; manager and other branches cannot edit.
3. Verify not-yet-started and expired offers are hidden by backend UTC clock; list order preserved by the owner.
4. Tap offer tile on iPhone PWA / Android: content popup overlays without moving Home; close/back, scroll, optional Menu CTA; no fake % discount.
5. Check 320/360/390/428 px, keyboard, focus, screen reader, safe areas and network loss/empty state. Record real-device tests as NOT TESTED if unavailable.
6. After explicit deploy authorization: API health/readiness and public endpoint, image HEAD/R2 CORS, Admin and Customer PWA production alias, login and order flow smoke tests.
