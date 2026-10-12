# NestJS API foundation — Issue #4, P1.1–P1.2

The HTTP service is bootstrapped with NestJS, strict TypeScript, Helmet,
a global request-id middleware, safe JSON exception responses and global
input validation. Run from monorepo root after `npm ci`:

```bash
npm run typecheck
npm test
npm run build
npm run start -w @hotpot/api
```

- `GET /health/live`: 200 while the process handles HTTP.
- `GET /health/ready`: 200 only when the PostgreSQL connection responds;
  503 otherwise. This verifies DB reachability, **not** Clerk/auth or complete
  production readiness.
- Default bind: `127.0.0.1:3000`, set `PORT` and `HOST` only with an
  operator-approved reverse-proxy/network configuration.
- Missing endpoints intentionally return 404; this phase does **not** expose
  unauthenticated business/customer/order APIs.
- Request identifiers are echoed only when sanitized. The error JSON never
  contains sensitive exception details or stacks.

This is **not** a production-ready API. Only the development baseline schema,
isolated CI migration and DB connectivity check are implemented. No production
migration, Clerk config, routing, order persistence API, VPS restart or deploy
is included. Follow-up PRs within #4 add JWT verification/RBAC tests.

## Development database (P1.2)

Prisma v6 schema and baseline migration are in `prisma/`; see
[`docs/ops/PRISMA-DEV-MIGRATION.md`](../../docs/ops/PRISMA-DEV-MIGRATION.md).
CI provisions an isolated PostgreSQL 16 instance and checks migrations, test
snapshots and readiness. No production DB is configured or changed.
