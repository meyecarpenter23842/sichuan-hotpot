# P4.5 / L08 — Integrated QA and release acceptance

**Issue:** [#101](https://github.com/meyecarpenter23842/sichuan-hotpot/issues/101), epic [#93](https://github.com/meyecarpenter23842/sichuan-hotpot/issues/93).  
**Baseline:** `24d8224f1c076c3151946da169065e52901e0e0c` (L07 merged, both PWAs subsequently deployed on 2026-10-15).  
**Scope:** evidence, integration regression and production release gates; **this PR does not deploy or migrate production**.

## Strict result vocabulary

- **PASS:** a specific automated check actually ran green on the latest PR commit, or a production release run explicitly succeeded.
- **FAIL:** observed counterexample with logs/artifact.
- **NOT TESTED:** no evidence; must not be presented as PASS.
- **BLOCKED:** an acceptance dependency (reference/source/device/production credentials) was unavailable.

A PR build, Playwright layout screenshot, or HTTP 101 WebSocket handshake is **not** a substitute for authenticated mobile/realtime/checkout acceptance. Follow `.agents/skills/professional-frontend-qa/SKILL.md`.

## Automated reproducible checks (disposable GitHub Actions/PostgreSQL)

| Contract | Code/evidence | Acceptance |
|---|---|---|
| Seven widths, three Admin menu subtabs | `scripts/qa/p41-admin-browser-qa.mjs` saves `apps/admin/qa-artifacts/l08-{products,modifiers,featured}-{320,360,390,428,768,1280,1440}.png` | Verify screenshot artifact on **latest** P0 workspace quality PR run; 21 images; no horizontal overflow and stable subtab placement |
| Real CRUD fixture | Same browser suite creates a category, product, size, group, option and saves featured product in disposable DB | Assert server persistence and role-based session, not mock/screenshot-only |
| Branch isolation | Same browser suite: actual MANAGER and two PostgreSQL branches, PATCH foreign category/product/variant/group/option, cross-branch product creation/reassignment | 403 for unauthorized branch; 404 for valid foreign UUID; DB rows unchanged |
| Input validation | Same browser suite: fractional VND, overlong XSS-shaped name, bad bearer token | 400/401 and no data mutation; this is **validation**, not a full penetration test |
| Switch failure and constraints | Browser suite verifies size and option persisted, rejects disabling only required option, seven-day hours persisted; prior unit tests check stale revision | PASS only on CI execution of this commit |
| Checkout/order safety | `apps/api/test/orders-checkout.test.mjs`, `apps/api/test/admin-orders.test.mjs`, `apps/api/test/l06-featured.test.mjs`, `apps/api/test/catalog.test.mjs` | CI covers idempotency, snapshots, routing refusal, feature revision and catalogue constraints |
| Data protection and migration rehearsal | `.github/workflows/workspace-ci.yml` disposable PG16 migration diff and `infra/vps/tests/ci_db_drill.py` | Disposable encrypted backup + isolated restore rehearsal only; **not a production backup** |
| Expo PWAs, typecheck, source and deployment controls | `P0 workspace quality` plus `Plan and no-auto-deploy guard` required runs | Latest PR HEAD PASS |

The browser suite uses localhost `127.0.0.1`, unique throwaway accounts and CI-only PostgreSQL. Never aim a reset, fixture, screenshot crawler or write check at the VPS database.

## Visual acceptance and screenshots

The owner's **three original P4.5 menu reference images are not versioned in this repository** at this baseline. Existing repo mockups do not prove that they are these three references.

| Visual requirement | Automated evidence | Reference comparison | Actual Safari iPhone / Android |
|---|---|---|---|
| Menu Món (closed/list, image/name/price) | `l08-products-*.png`, seven widths | **BLOCKED: reference absent**; test placeholder image, not R2 visual fidelity | NOT TESTED |
| Nhóm tùy chọn (group, size, option) | `l08-modifiers-*.png`, seven widths | **BLOCKED: reference absent** | NOT TESTED |
| Món gợi ý (actual saved selection) | `l08-featured-*.png`, seven widths | **BLOCKED: reference absent** | NOT TESTED |
| Safe area, Safari keyboard, VoiceOver, physical tapping, installed PWA push/GPS | Playwright Chromium is not a substitute | NOT TESTED | NOT TESTED |
| R2 upload/remove/reload on production images | Code and sandbox unit tests exist | NOT TESTED against live R2 | NOT TESTED |

After CI passes, download **Admin browser QA screenshots** artifact from the P0 run for the exact PR HEAD. The 21 new images cover 3 tabs × 7 viewport widths; visual comparison to the owner's unversioned references is deliberately **not** claimed. Attach matching source screenshots in a separate authorized PR and obtain human reviewer confirmation before visual sign-off.

## Further acceptance required before closing #101 / #93

| Workstream | Status | Next acceptance evidence |
|---|---|---|
| Actual OWNER/MANAGER/KITCHEN/CUSTOMER in live Admin, scoped at two real branches | NOT TESTED | Role 403 and multi-admin simultaneous updates on non-disposable accounts, non-destructive |
| Shared group across two products; min/max; old group retention | **BLOCKED by implementation gap** | Repo P4.5 L05 uses product-scoped groups, not a shared library; see `apps/admin/src/ModifierGroupsPanel.tsx`; track as product gap, not QA PASS |
| Mid-cart option/product turned off, then checkout after reconnect | NOT TESTED in full production browser flow | No invalid order, clear server error, unchanged historical totals |
| Realtime WSS authenticated subscription + event delivery + reconnect | NOT TESTED (only transport handshake verified in [#107](https://github.com/meyecarpenter23842/sichuan-hotpot/issues/107)) | Two real clients, missed-event reconciliation and safe release logs |
| Mobile screenshots compared with owner's exact three references | BLOCKED | Version references with owner permission and review before sign-off |
| Production VPS DB backup/restore and new migration | NOT AUTHORIZED / NOT RUN | Separate owner-approved run and isolated restore proof **only if new production migration is required** |
| Production R2 operation, order, checkout smoke after L08 release | NOT TESTED | Owner-approved release workflow, authorized real-usage smoke and error log review |
| Local `F:\\1_A_Disk_D\\hotpot` sync | NOT TESTED | Environment cannot reach Windows F:; never claim a pull |

## Release matrix (as of opening this L08 PR)

- **2026-10-15 L07 baseline:** Customer PWA success [run 38705669966](https://github.com/meyecarpenter23842/sichuan-hotpot/actions/runs/38705669966), alias `www.bepsi.click`; Admin PWA success [run 38705664946](https://github.com/meyecarpenter23842/sichuan-hotpot/actions/runs/38705664946), alias `admin.bepsi.click`.
- **L08 new code:** CI-only browser QA; no app bundle change, no PostgreSQL migration, no new PWA or VPS deployment requested.
- **Required gates:** PR HEAD checks green, no merge conflict, QA artifacts inspected, then squash PR per repo process. Production deployment only via owner-approved Issue #3 release command; **merge is not deploy**.
- **Rollback:** use `docs/ops/DEPLOYMENT-RUNBOOK.md`. Do not reset production DB, retry destructive migration, or present disposable CI restore as live recovery proof.

## Discovered release blockers (not silently waived)

1. **P1 acceptance — unversioned three P4.5 design references.** Owner/reviewer must supply original sources and compare screenshots. Responsible: design acceptance; evidence: this report + artifacts.
2. **P1 functional acceptance — true reusable option-group library across products not proven.** Current implementation explicitly scopes groups to products. Responsible: P4.5 architecture/issue #97–#98; investigate implementation and integration coverage before sign-off.
3. **P1 acceptance — end-to-end authenticated production realtime, concurrent admin, cart/checkout with availability change and physical iPhone/Android tests unverified.** Responsible: production QA; non-destructive test credentials required. Keep #107 and #101 open.

**L08 PR may be merged after its own required CI passes, but #101 is not eligible for closure until the missing acceptance evidence is supplied.**
