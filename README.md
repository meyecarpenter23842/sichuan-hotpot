# Sichuan Hotpot — Lẩu Tứ Xuyên & Trà Sữa

**Status:** planning only; 8 UI/UX concept images present, production applications not yet bootstrapped.

- [Master implementation plan](docs/plan/MASTER-PLAN.md)
- [Manual deployment recipes: Vercel / VPS API / PostgreSQL](docs/ops/DEPLOYMENT-RUNBOOK.md)
- [VPS incident investigation — read-only](docs/ops/INCIDENT-READONLY.md)
- [Frontend QA policy](docs/qa/FRONTEND-QA.md)
- [Agent conventions + skill](AGENTS.md)

## Deploy lock
Automatic deployment is forbidden for **all** environments. `apps/customer/vercel.json` and `apps/admin/vercel.json` permanently set `git.deploymentEnabled=false`. GitHub Actions may run CI automatically, but deploy/migrate/rollback require an explicit manual release procedure. A Vercel account owner must confirm each actual Vercel project's Git integration is disabled/locked after provisioning; repo config alone is not a verification of a provider setting.

## UI concept images on main
Customer: `01-home.png`, `02-hotpot-detail.png`, `03-delivery-address.png`, `04-order-tracking.png`.
Admin: `01-dashboard.png`, `02-kitchen-order-detail.png`, `03-delivery-settings.png`, `04-driver-assignment.png`.

Images depict **illustrative** customer details, prices, ratings, addresses and driver information; do not treat them as production values.

## Manual GitHub Actions operations
- [Manual SSH VPS audit and release workflows](docs/ops/MANUAL-OPERATIONS.md).
- The VPS audit uses SSH user `ubuntu` with a dedicated audit key, pinned host key, and bounded aggregate output; it does **not** use sudo, restart, migrate or deploy.
- API / DB / Vercel production release workflows are **OFF by default** until their protected environment variable `HOTPOT_RELEASES_ENABLED=true` is separately authorized after the required app/VPS bootstrap. A workflow in GitHub is not a deployed service.
