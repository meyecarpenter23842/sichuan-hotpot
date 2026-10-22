# L09 — Dine-in production security, E2E and release gate (Issue #251)

**Status: RELEASE BLOCKED until every P0 gate is evidenced.** This document tracks real evidence, not a claim that the public rollout is finished. Code review / disposable CI passing does **not** authorize deployment or a production database migration.

## Scope and invariant

- One physical dining session = one closed invoice; tickets can be issued in multiple rounds, but rejected/canceled/awaiting-approval tickets are **not** kitchen work or chargeable.
- Staff payment confirmation is authoritative: QR requests in PENDING do not mean money was received. Amounts are integer VND, calculated on the server, and each tender/payment action is idempotent.
- A historical CLOSED invoice remains unchanged when an OWNER/MANAGER refunds a confirmed payment. Refund is a distinct negative cash event on `DiningAuditEvent.createdAt`; a repeated or racing refund creates only one event.
- Existing delivery financial report `/admin/orders/:branchId/business-report` must retain its independent reporting semantics. Dine-in has separate endpoints/clocks.
- Production dates are `Asia/Ho_Chi_Minh`; database timestamps use UTC. Never extrapolate cash collection from `createdAt` or a pending payment.
- CASHIER can take/confirm payments but cannot see unrestricted business reporting; KITCHEN, WAITER and DRIVER cannot access finance reports or another branch's staff data.

## Automated gates (run only against disposable PostgreSQL in GitHub Actions)

| Gate | Evidence | Result criterion |
| --- | --- | --- |
| Atomic open and transfers | `scripts/qa/dining-db-invariants.mjs`, `scripts/qa/dining-api-invariants.mjs` | Two simultaneous opens yield one active session; moving into an occupied table fails; original table QR revoked on transfer |
| QR guest scope and duplicate requests | `scripts/qa/dining-api-invariants.mjs`, `scripts/qa/l05-menu-browser-qa.mjs` | QR only authorizes an active table; grants revoked on rotate/close; separate browsers cannot read each other's pending tickets; repeated idempotency keys do not duplicate |
| Staff authorization and kitchen | `scripts/qa/dining-api-invariants.mjs`, `scripts/qa/l04-retail-browser-qa.mjs` | Unauthorized roles/foreign branch rejected; concurrent approval creates one kitchen ticket |
| Settlement and late refunds | `scripts/qa/dining-api-invariants.mjs` | Concurrent QR confirmation/collection does not overcharge; after CLOSED, dual refund is one audited outflow; invoice unchanged; no new payment after close |
| Shared Wi-Fi and rate-limits | `scripts/qa/l05-menu-browser-qa.mjs` plus API throttler config | 30 consecutive real QR locator requests from one source IP do not return 429; issue-grant/ticket mutation endpoints still have lower limits, plus DB per-session limits |
| Reports and regression | `scripts/qa/dining-api-invariants.mjs`, `apps/admin/test/l08-dining-report.test.mjs` | VN-day boundary, gross/refunds/net, SQL pagination, cashier/kitchen denial, delivery report unchanged |
| Desktop and mobile Chromium | `scripts/qa/l04-retail-browser-qa.mjs`, `scripts/qa/l05-menu-browser-qa.mjs` | Real interactions, screenshots, no horizontal overflow at tested viewport widths |
| Build/backup rehearsal | `.github/workflows/workspace-ci.yml` | API/Admin/Customer/Retail/Menu lint, typecheck, tests, builds, disposable Postgres migration and isolated restore drill all pass on *latest PR head* |

**Automated status:** Not PASS until the exact L09 PR head has successful required checks. CI's backup drill operates only on a disposable localhost database, **not** production.

## Manual security review: P0 before release

1. **Static QR photograph/remote reuse** — a copied valid table QR is a bearer locator; there is no cryptographic proof of physical presence. Staff **must** approve every QR-origin ticket before kitchen work. Rotate QR if a table code/photo leaks, and verify old grants and requests are rejected. Static QR alone cannot guarantee the scanner is physically at the table; do not claim otherwise.
2. **Session replay** — scan a closed/rotated handle, re-use a revoked grant, try a previous table's guest credential, change the branch/table in requests. Expect 401/403/404/409 with no disclosure and no persisted kitchen order.
3. **Concurrency** — two devices open a table; two guests send with the same/different idempotency keys; two staff approve; two cashiers confirm/collect; simultaneous close/guest ticket; transfer to occupied table. Verify database row counts, audit and realtime after reconnect; no duplicate notifications that could trigger kitchen twice.
4. **Auth and leakage** — manually test OWNER, MANAGER, WAITER, CASHIER, KITCHEN, DRIVER and outsider against two branches. Inspect browser URL, console, logs, cached response, screenshot and notification content for tokens/phone/address/financial leakage. Check WebSocket Origin enforcement, API CORS, no cross-origin credential reflection and no unsafe public caching.
5. **Guest denial-of-service** — shared restaurant Wi-Fi with multiple devices; backoff on 429, rate-limit grant minting and ticket writes; verify no unlimited creation of guest grants or pending tickets from a photographed QR.
6. **Refund policy** — staff OWNER/MANAGER must log a reason and verify the refund actually happened off-system before recording an audited cashflow reversal. Repeated requests must not record a second refund. Check time zone and cross-day report after closing.
7. **Regression** — customer Google/Clerk session, delivery order status, shipping/report, existing Admin push/FCM, Android release signing certificate remain unchanged.

**Manual E2E acceptance (not yet executed):** Admin area/table/QR → staff login Retail → open session → guest iPhone Safari/Android Chrome scans without login → two rounds of items → Retail notification badge + test sound without a real order → staff approves once → kitchen updates → transfer table and old QR rejection → cash or manually confirmed QR → receipt/print preview → close/clean table → finance reconciles. Include 320/360/390/428/768/1024/1280/1440 widths where applicable, safe area, scroll, keyboard, offline/reconnect and installed PWA push restrictions. Real printer/hardware, iPhone Safari, Android Chrome and permission prompts must be marked **NOT TESTED** unless evidence exists.

## Infrastructure inventory — read-only Vercel snapshot 22 October 2026

| Item | Provider observation | Remaining release action |
| --- | --- | --- |
| Retail | `sichuan-hotpot-retail`, ID `prj_Jpf6VJh61oUVQK9Gy1iJUKEqEFdi`; `retail.bepsi.click` verified | Production READY deployment points to older main `96683c95...`, not latest L08/L09 |
| Menu | `sichuan-hotpot-menu`, ID `prj_c5iMwXob29KVWiJev6MVQ9YIhVra`; `menu.bepsi.click` verified | Production READY deployment points to older main `d96944c9...`, not latest L08/L09 |
| DNS | Both custom domains verified by Vercel; external Cloudflare nameservers; no Vercel conflict reported | Re-test public HTTPS, correct origin, cache and domain routing from live browser; verified project mapping is not functional QA |
| Repo | `main` baseline `675eb62a6f8ac819d9afe4ca3d39e8374722189b`, L08 merged | Require current main + L09 PR required CI green, verify new HEAD and no conflict |
| API/DB | L07 additive schema was merged; production migration state not independently verified | Read-only determine whether real production DB is Neon or VPS, check actual Prisma migration status and API compatibility before any release |
| Vercel deploy process | Separate owner-only manual Retail/Menu release workflow and protected environments | Do **not** post `/deploy-hotpot-retail` or `/deploy-hotpot-menu` until backend compatible, approved migration and smoke ready |

This is not a production reachability or full TLS certificate test. Keep environments isolated; API `CORS_ALLOWED_ORIGINS` must explicitly allow `https://retail.bepsi.click` and `https://menu.bepsi.click` before release (no wildcard).

## Owner-approved production order (NOT authorized by this PR)

1. Record approved commit SHA, change set, DB host identity/instance, current API migration state, branch permissions, Vercel production env and rollback operator. Confirm every L00–L08 acceptance, including UI sign-off.
2. **Only after explicit separate owner approval:** take encrypted production backup, verify integrity and isolated restore using the correct PG version. Review migration SQL for lock/data risks, and test in a disposable clone. No `migrate reset`, data deletion or guessed environment changes on production.
3. With approved API maintenance plan, apply only reviewed pending additive migration; record migration checksum, health/ready, DB/Clerk/Google auth and permissions. Prepare compatible forward-fix (a database downgrade is not an assumed rollback).
4. Deploy API through its explicit owner-only workflow, verify CORS/realtime/QR endpoints with read-only probe, then deploy Retail and Menu **independently** with manual Vercel workflows. Merge is not deploy.
5. Run approved smoke with safe designated test tables/real devices and reconcile tickets, payment, receipt, kitchen, realtime, refunds, finance and delivery regression. Do not charge a live customer or create operational orders merely to test.
6. If blocked, disable new dine-in ordering or roll back **frontend/API build only** to the last compatible verified revision via approved workflow. Do not revert the DB blindly. Record incident, timestamps, scope and affected orders.

## Release decision

- **BLOCKED P0:** production DB/migration status and isolated production restore evidence unknown; real device Safari/Android end-to-end security + payment/receipt + authorized smoke not evidenced; current deployments are older than merged code.
- **NOT TESTED:** production API CORS, current public HTTPS response, staff login, realtime+push, printed bill and shipping/Android signing regression after L09.
- **No production deploy or migration** is performed as part of Issue #251 code review. Release requires explicit authorization; leave Issue #251 open until the checklist has proof.

Every reported PASS must link its exact check/run or witnessed artifact; a simulated browser is not a hardware acceptance result.
