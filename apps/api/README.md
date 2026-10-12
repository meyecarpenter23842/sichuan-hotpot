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
  503 otherwise. This verifies DB reachability, **not** Google/username auth or complete
  production readiness.
- Default bind: `127.0.0.1:3000`, set `PORT` and `HOST` only with an
  operator-approved reverse-proxy/network configuration.
- Missing endpoints intentionally return 404; this phase does **not** expose
  unauthenticated business/customer/order APIs.
- Request identifiers are echoed only when sanitized. The error JSON never
  contains sensitive exception details or stacks.

This is **not** a production-ready API. Only the development baseline schema,
isolated CI migration and DB connectivity check are implemented. No production
migration, direct Google/username auth, routing, order persistence API, VPS restart or deploy
is included. Follow-up PRs within #4 add Google identity verification, username/password sessions, DEV-only replacement of the provisional `User.clerkSubject`, and RBAC tests.

## Development database (P1.2)

Prisma v6 schema and baseline migration are in `prisma/`; see
[`docs/ops/PRISMA-DEV-MIGRATION.md`](../../docs/ops/PRISMA-DEV-MIGRATION.md).
CI provisions an isolated PostgreSQL 16 instance and checks migrations, test
snapshots and readiness. No production DB is configured or changed.

## Development authentication (P1.3)

Auth endpoints: `POST /auth/register`, `POST /auth/login`, `POST /auth/google`,
`POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`,
and `GET /auth/admin/:branchId`. Register is limited to CUSTOMER;
server checks staff roles and branch membership.

Required backend secrets: `AUTH_JWT_SECRET` (high-entropy, minimum 32 bytes).
Google sign-in additionally needs `GOOGLE_CLIENT_ID` (the *web Client ID* for
the customer PWA); Google ID tokens are verified server-side using published
Google keys. **The existing Google Client Secret is not needed for this
ID-token verification flow**; do not store it in mobile/web assets.

Returned refresh tokens must be held only in protected native secure storage,
or exchanged for Secure HttpOnly session cookies in the future web adapter.
Do not use localStorage. This phase does not include production web cookie/
CSRF integration, account recovery or complete operator provisioning.

**Do not deploy this dev-only foundation as a production ordering API.**
It remains blocked by VPS release provisioning, authenticated E2E flows and
separately approved production migration.
