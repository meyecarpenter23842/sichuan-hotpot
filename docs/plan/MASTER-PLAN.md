# SICHUAN HOTPOT — Master implementation plan

Status: PROPOSED / NOT IMPLEMENTED. This document defines the target architecture, sequence, tasks, dependencies and acceptance gates. It does not authorize production deployments or migrations.

## 0. Verified starting point (2026-10-12)
- Source: [sichuan-hotpot](https://github.com/meyecarpenter23842/sichuan-hotpot), main. Eight PNG UI/UX mockups committed in repository root; no application source, tests or workflow at inspection.
- Vercel destination requested by owner: `https://vercel.com/meyecarpenter23842`. Linked Vercel accounts available for inspection in this conversation did **not** expose that scope or a Hotpot project. Provider controls are **UNVERIFIED**, not reported disabled. On documentation PR #1 GitHub reported a Vercel status check pointing to `vercel.com/meyecarpenter23842/sichuan-hotpot`; accordingly a repository-root `vercel.json` block is also committed, but real provider disablement still needs a confirmed Vercel project readback.
- Reference implementation: [binhnxwjfjxm/NPP-Platform](https://github.com/binhnxwjfjxm/NPP-Platform). See its manual Vercel/VPS deploy workflows, production audit, migration and [deployment-control incident](https://github.com/binhnxwjfjxm/NPP-Platform/blob/main/docs/operations/vercel-manual-deployment-control-2026-07-27.md). Reuse principles, **not credentials, host names, production project IDs, scripts or legacy issue-comment triggers**.
- Frontend skill: [professional-frontend-qa](../../.agents/skills/professional-frontend-qa/SKILL.md), imported/adapted from owner-uploaded ZIP with accompanying references.

## 1. Goals and invariants
Build a **single-store, multi-branch-ready** restaurant ordering system with one customer app (Android native + iPhone PWA), a separate admin app (Android + Web PWA), one NestJS API on VPS and one PostgreSQL instance on VPS. Self-delivery only; no third-party courier integration required. Browse menu anonymously; login Google with Clerk to checkout; require verified/usable phone, address and pinned coordinates. Ship charged on actual road route meters from store to customer, with editable fee policy. Backend is price authority.

**Release invariant: absolutely no automatic deploy from Git push, PR, merge, tag, Vercel Git integration, Expo EAS submit/update or infra scripts.** CI may auto-run checks, and alerts may auto-notify; neither may promote a release. Do not confuse CI green, merge, staging test, deployment and production verification.

## 2. Target architecture
```text
apps/customer   Expo React Native Android + Expo web iPhone PWA
apps/admin      Expo React Native Android + web PWA (OWNER/MANAGER/KITCHEN/DRIVER)
apps/api        NestJS TypeScript REST + WebSocket, Clerk JWT verification, Prisma
packages/shared DTO schemas, types, status machine, API contracts
packages/ui     shared tokens/components only when cross-platform practical
infra/          manual deployment templates, observability, release manifest
docs/           architecture, UX, runbooks, ADR, tests, operational checklist
```
Start with a package-workspace monorepo (choose lockfile/package manager once during bootstrap). TypeScript strict, Zod/class-validator as suitable, Prisma migrations, ESLint, Prettier, Vitest/Jest appropriate to package, React Native Testing Library, API integration/e2e tests. Keep domain code separate from platform UI.

- Auth: Clerk Google (Android Expo SDK, web integration); backend verifies issuer/audience/signature and maps immutable Clerk subject -> internal user ID; role permissions evaluated server-side. Guest browsing permitted.
- Media: object storage with validated upload, image variants and file limits; never commit high-resolution menu images as runtime catalogue.
- Push: Android FCM, Web Push for eligible installed iPhone PWA; user opt-in, retry/outbox and foreground sound in admin. Push not source of truth.
- Real time: WebSocket event plus polling/reconciliation on reconnect; version/cursor replay or full refetch to avoid missing orders.
- Maps: real routing API road distance with cached quote TTL and provider failure handling. Human-readable address + lat/lng required and reconciled by user confirmation.
- Payments: COD and manual bank QR MVP with explicit reconciliation and pending/paid status. Do not mark QR paid from screenshot/client claim.
- Security: TLS, minimum DB privileges, private network access, no secrets in browser or logs, rate limits, audit trail, backups and retention policy.

## 3. User journeys and UI screens
**Customer:** (1) home banners/catalogue/search; (2) category and product listing; (3) customizable Sichuan hotpot: portion/broth/spice/toppings; (4) milk tea: size/sugar/ice/toppings; (5) cart; (6) Google login then phone capture; (7) save/add address, GPS permission, manually drag pin and confirm street number; (8) server road-route fee quote; (9) COD/QR checkout; (10) order status + contact store; (11) order history/reorder; (12) profile, addresses, notification preferences.
**Admin:** (1) owner dashboard; (2) new-order queue with bell/sound; (3) accept/reject with reason; (4) kitchen ticket/preparation; (5) ready queue; (6) driver dispatch and assignment; (7) driver mode pickup/navigation/call/COD confirmation/failure reason; (8) catalog/topping/stock toggle; (9) delivery-fee/branch/settings; (10) roles/staff; (11) sales/COD reconciliation; (12) audit/alerts.
Mockups are visual references only; build realistic behavior, accessible interaction and operational density.

## 4. Business model and data design
Initial Prisma entities: Branch, StoreSettings, DeliveryPolicyVersion, CatalogCategory, Product, ProductVariant, ModifierGroup, ModifierOption, InventoryAvailability, User, CustomerProfile, Address, Cart, CartItem, Order, OrderItem, OrderItemModifierSnapshot, DeliveryQuote, DeliveryAssignment, DriverShift, Payment, CODHandover, OrderStatusHistory, PushSubscription, NotificationOutbox, AuditEvent, IdempotencyKey.

- Index `(branch_id, status, created_at)`, `(customer_id, created_at)`, unique idempotency key scoped per checkout identity. Preserve price/fee/discount/distance/policy snapshots at order time.
- Store monetary values integer VND; time UTC; sensitive phone/address/GPS access scoped to authorized roles.
- Orders state machine: `PENDING -> CONFIRMED -> PREPARING -> READY -> DELIVERING -> DELIVERED`; explicitly model CANCELED and DELIVERY_FAILED with authorized transitions. Driver assignment separately audited; do not conflate ORDER status with COD settlement.
- Checkout transaction: authenticated customer; validate availability and modifiers; compute prices and discount server-side; validate phone/address; compute/revalidate delivery quote; enforce policy radius/min order; reserve order once using idempotency key; persist order, history and outbox atomically; respond stable order ID. Duplicate requests cannot duplicate an order.
- Shipping fee default **example only**: 2 km base=10,000 VND, next started kilometer=5,000 VND, max road 8 km, minimum cart 80,000 VND. `distance_meters` is real route from provider; `extra_km=ceil(max(0,distance_meters-base_meters)/1000)`. Apply configurable rounding; an unrouteable address cannot silently receive zero fee.
- COD handover reconciled by delivery/driver/shift, independently of delivered status.

## 5. Implementation phases and acceptance gates
Each phase is its own issues/PRs (small enough to review). Do not start production deployment just because a phase merges.

### P0 — Controls / bootstrap (first)
1. Restore/organize UI references under `docs/ui-reference/{customer,admin}` only via dedicated asset PR after verifying binary history and links; no destructive moves during plan PR.
2. Bootstrap workspaces, shared lint/format/typecheck/test/build commands and CI jobs. Provide reproducible `npm ci`/lockfile setup; Android compile on runner/emulator as budget permits.
3. Protect main with required CI and reviews (repo owner/admin setting). Add secret scanning, dependabot or comparable checks.
4. Enforce no-auto-deploy at all surfaces: `git.deploymentEnabled=false` in repository root **and** every Vercel PWA project root, no `push`-based deploy workflow, EAS auto-submit/update disabled, VPS webhook/cron/git-pull timers audited. Verify provider readback.
5. Create DEV/STAGING/PROD environment mapping with explicit IDs later; do not put private paths/IPs in public docs.
**Exit:** workflow passes on current PR HEAD, main protection confirmed, Vercel project configs reviewed, release policy adopted. Production deploy NOT PERFORMED.

### P1 — API foundation / DB / auth
1. NestJS bootstrap, error model, health live/ready, structured redacted logging, trace/request IDs, input validation, security headers/rate limit.
2. Prisma baseline for users, branches, catalog, orders, roles and delivery versions; development DB only.
3. Clerk Google integration in Expo Android and web PWA; backend JWT verify and OWNER/MANAGER/KITCHEN/DRIVER/CUSTOMER authorization tests.
4. Prisma migration test up/down feasibility, sample seed **development only**, backups and restore rehearsal doc.
**Exit:** integration tests 401/403 pass, authenticated profile flow works, no production DB touched.

### P2 — Customer catalogue / cart
1. Shared UI tokens informed by mockups; products/categories/search, detail/option selectors, stock and loading/error.
2. Persistent cart with modifiers and quantity; no client-side trust in price.
3. Profile/phone/address forms, device GPS opt-in, manual pin fallback, saved addresses.
4. Professional Frontend QA matrix and Android emulator / Safari iPhone PWA test plan.
**Exit:** guest browse, login-on-checkout and stable cart; no accidental double-submit.

### P3 — Routing / delivery quote / checkout
1. Routing provider abstraction; store/customer geocode and route request, cache by coordinates/provider/time; timeout/retry budget.
2. Versioned delivery policy editable by OWNER; base km, fee, incremental fee, rounding, max road distance, minimum order, free-ship threshold, open/closed state.
3. Quote endpoint with reproducible breakdown/expiry, explicit OUT_OF_RANGE/UNROUTABLE/STORE_CLOSED errors.
4. Transactional idempotent order creation + COD or QR pending; snapshots preserved.
**Exit:** boundary tests at 2.0/2.1/4.3/8.0/8.1 km, address change reprices, provider failure blocks checkout; concurrency test proves single order.

### P4 — Admin / kitchen / realtime
1. Role-aware admin app independently packaged; menu CRUD, modifiers, temporary out-of-stock and store hours.
2. Order queue, audible new-order alert when foregrounded, FCM/Web Push where supported, stale-order escalation.
3. Kitchen station, accepted/rejected/reason and status transitions + audit/outbox.
4. Reconnect/offline read recovery with explicit sync state.
**Exit:** two parallel orders cannot be accepted or transitioned illegally; notifications tested without treating them as sole data source.

### P5 — Self-delivery / money
1. Dispatch driver picker/availability and assigned order permission boundaries.
2. Driver view GPS/map deep link, pickup, call customer, deliver/fail with reason, offline recovery.
3. COD amount owed, receipt confirmation, cash handover and reconciliation.
4. Owner dashboard and initial revenue/order status metrics from real data.
**Exit:** full E2E order -> kitchen -> driver -> delivered/failed, audited; driver cannot view unrelated customers.

### P6 — Production readiness and controlled release
1. API security, load/rate/retry testing, vulnerability/dependency scan, incident simulations and privacy checks.
2. UI acceptance: 320/360/390/428/768/1280/1440, safe area, Vietnamese font, screen reader/focus, Safari install/GPS/push, Android emulator; record PASS/FAIL/NOT TESTED.
3. Configure Vercel PWA projects through correct owner account, verify Git auto deploy disabled for ALL branches; prepare manual CLI deployment.
4. VPS baseline READ-ONLY inventory before changing anything; DB isolation, Postgres backup/restore test, TLS, reverse proxy, process manager, release staging.
5. Explicit release approval -> manual DB migration if required -> manual backend release -> manual frontend release -> smoke/rollback readiness.
**Exit:** health/live, health/ready, Clerk login, read menu, create controlled test order, admin receives, kitchen/driver/COD flows; evidence links. No unapproved deployment.

## 6. Release and change control
- Separate release paths: frontend Customer PWA, Admin PWA, Android artifacts, NestJS backend, Prisma schema. Manual release request always names target+environment+immutable SHA; each subsystem may deploy independently.
- PR CI has no deployment secrets or SSH. Deploy jobs must use `workflow_dispatch`, protected GitHub Environment, explicit reviewer approval, least permissions, concurrency serialize, exact main SHA check, log sanitization, health checks, rollback docs. No `issue_comment` triggers.
- DB migration: plan + backup + restore rehearsal + approval + single migration runner with lock + validation. Backend rollback cannot automatically reverse destructive DB changes.
- Vercel: the `vercel.json` Git gate must remain false even while manually deploying; **never toggle it in commits** to trigger deploys.
- VPS failure: start with [read-only diagnostic procedure](../ops/INCIDENT-READONLY.md), no restart/redeploy/migrate without separate approval.
- Exact details in [deployment runbook](../ops/DEPLOYMENT-RUNBOOK.md).

## 7. Risks / decisions pending
- Vercel team URL provided but its scope not currently accessible through connected account: cannot verify or change provider setting; owner must connect correct account or perform dashboard verification.
- VPS reachable? SSH host-key/user/process-manager/DB names unknown: **NO CONNECTION ATTEMPT YET**, do not assume service/DB safe to change.
- Android production distribution strategy (APK internal vs Play Store), routing vendor and costs, QR reconciliation approach, DNS/SSL, branch protection settings and production naming require later approval.
- Uploaded mockup prices, names and addresses must be replaced with admin-managed real data.
- CI added with this documentation PR validates planning artifacts only; it does not mean app builds or production tests passed.

## 8. Acceptance evidence and handoff
Every issue/PR names scope, dependency, test procedure and done definition; CI logs on exact HEAD; UX screenshots if available; production release has SHA/target/operator/timestamp/health/readback/rollback report. Report local Windows sync as NO unless actually accessed. No background monitoring or VPS repair implied by this plan.
