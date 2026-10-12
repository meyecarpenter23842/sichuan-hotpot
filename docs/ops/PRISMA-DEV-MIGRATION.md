# P1.2 — Prisma development migration policy

**Scope:** DEV/isolated GitHub Actions PostgreSQL only. The new baseline
migration must never run against production until a separate approved
release, a verified backup **and restore rehearsal**, and a reviewed window.

- Schema: `apps/api/prisma/schema.prisma`.
- Client: Prisma v6, generated explicitly after `npm ci --ignore-scripts`.
- Migration: `apps/api/prisma/migrations/20261012000000_init/migration.sql`.
- Local DEV: set `DATABASE_URL` **privately** to a disposable PostgreSQL
  database and run `npm run prisma:validate`,
  `npm run prisma:generate`, then `npm run prisma:migrate:dev`.
  Never put connection URLs or database dumps in commits, logs or issues.
- PR CI: PostgreSQL 16 service in an isolated GitHub-hosted runner; apply
  migrations with `prisma migrate deploy`, run schema drift checks and HTTP/DB tests.
- Test fixtures are random and rolled back. They are not a production seed.
- No production connection, SSH, VPS or application deploy is part of P1.2.

## Recovery assessment

In an isolated DEV database, restore its database-level backup or drop and
recreate a **disposable test database** after confirming it has no retained
customer data. Never run `prisma migrate reset` against a shared,
staging or production database. For real data, first measure migration impact,
take an encrypted backup, rehearse restoring in a separate database and
arrange a separately approved migration. Baseline introduces tables; it does
not authorize drop or destructive rollback. Production release procedures
remain governed by `docs/ops/DEPLOYMENT-RUNBOOK.md`.

## Deferred to subsequent Issue #4 PRs

Clerk JWT and branch-scoped RBAC, all order mutations/idempotent checkout,
authorized product/branch/settings APIs, driver privacy, recovery/outbox,
and production readiness. DB connectivity alone does not imply the
application is ready for customer traffic.
