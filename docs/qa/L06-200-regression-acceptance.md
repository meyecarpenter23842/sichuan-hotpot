# L06 / EPIC #194 — QA hồi quy (Issue #200)

Date: 2026-10-19. This is an evidence log, not a blanket release certification.

## Verified repository defect / fix
- **FAIL on main `ce1a7dc`:** `GET /admin/orders/:branchId` returns only newest 100; status tabs filter these 100 in JS, so even existing historic deliveries disappear if the shop has >100 newer orders.
- **FAIL on main:** Customer order list returns only 50; Purchased Products only examines up to 20 completed orders inside those 50, so it cannot find earlier delivered orders.
- **Fix:** additive authenticated `/admin/orders/:branchId/pages?group=history&limit=25&cursor=...` and `/customer/orders/pages?delivered=1&limit=20&cursor=...`. Stable `createdAt DESC,id DESC`; cursor always checked in **same staff scope, group/driver assignment or customer scope**; invalid/foreign cursor rejected. Limit bounded at 50. No schema migration.
- **UI:** per-lane Admin "Xem thêm đơn cũ" and truthful selected-lane total; Customer "Xem thêm đơn hàng cũ"; Purchased Products "Xem thêm món đã mua" batches 3 detail requests, dedupes variant/topping/combos using original existing fingerprint.
- **Realtime:** Admin loads selected lane on sync; Customer retains already paged older rows when status updates arrive. Explicit refresh resets list safely. Legacy endpoints kept for old Android APKs.

## CI gates (fill with actual final run IDs, never predict)
- Lint/typecheck/tests, DB integration, Expo Customer/Admin PWA builds and 320/360/390/428 screenshot/browser QA: **NOT VERIFIED UNTIL HEAD CI FINISHES**.
- Native Android Admin debug/release-equivalent, Windows Admin/Customer release: **NOT VERIFIED UNTIL HEAD CI FINISHES**.
- Test fixtures include >100 same-createdAt orders, delivered-only 50+ older records, foreign cursor and cross-branch/DRIVER/KITCHEN ACL: added in current PR, must finish CI.
- No change to production data or API in production until approved release.

## Real-device UAT: NOT TESTED (must capture device/screenshot/log proof)
1. **Admin Android (real Firebase config):** new order push (foreground, background, killed), custom chime, click notification → exact order, permission revoked, FCM test action without creating an order.
2. **Customer Android:** only CONFIRMED, CANCELED, DELIVERING notifications; PREPARING/READY/DELIVERED silent; notification deep link to detail, reconnect after offline, app killed/background.
3. **iPhone Safari and installed PWA:** login persists, Add to Home Screen, GPS permission + map pin, Web Push on supported device, keyboard/safe-area, 320/360/390/428 px viewports, no overlap of bottom navigation/chat.
4. **Delivery and COD:** create COD/QR, assign DRIVER, deny unrelated branch/driver data, correct order transitions and status history, cancellation/refunds handled by policy, retry after network loss, idempotent checkout.
5. **Address and shipping:** 57/45 configured geographic filtering, pre-existing saved address, zone fallback never defaults to 0đ if unknown, re-quote after changed location, coordinates retained. Use fake/test accounts — not a live customer's private data.
6. **Catalog/R2:** new product image, combo+topper image, attach/remove with confirmation, shared media reference, failed PUT/network recovery, correct customer images, no duplicate product.
7. **History with volume:** seed 120+ orders in isolated CI or staging; compare Admin status groups and Customer delivery history to API count, go through all pages, switch tabs, refresh, offline/online. Do not seed production with fake orders.
8. **Responsive accessibility:** safe area, keyboard scroll, sticky tabs, 44+px touch targets, visible empty/error/loading states, 768px tablet, 1280/1440px desktop in browser.

PASS for CI does **not** imply PASS for iOS Safari, FCM device chime, Android production APK or production R2 uploads.

## Release blockers
- Real-device FCM/chime test from previous L01 remains **NOT TESTED**, not silently marked done.
- Main branch merge only on latest required CI green and no conflict. VPS migration/deploy is a separate approved action. Local Windows `F:\\1_A_Disk_D\\hotpot` cannot be touched by GitHub tooling; must protect dirty working tree.
