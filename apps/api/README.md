# NestJS API foundation — Issue #4, P1.1

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
- `GET /health/ready`: **503 by design** until the subsequent Prisma
  connectivity and Clerk authorization work proves dependencies are ready.
- Default bind: `127.0.0.1:3000`, set `PORT` and `HOST` only with an
  operator-approved reverse-proxy/network configuration.
- Missing endpoints intentionally return 404; this phase does **not** expose
  unauthenticated business/customer/order APIs.
- Request identifiers are echoed only when sanitized. The error JSON never
  contains sensitive exception details or stacks.

This is **not** a production-ready API. No database migration, credentials,
Clerk config, routing, order storage, VPS restart or deployment is included.
Future PRs within #4 add Prisma development schema, real readiness checks and
JWT/RBAC with integration tests.
