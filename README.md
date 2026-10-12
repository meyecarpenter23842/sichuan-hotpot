# Sichuan Hotpot — Lẩu Tứ Xuyên & Trà Sữa

**Status: P1 API foundation in progress — not production ready.** The NestJS API boots with health and safe HTTP handling. Readiness returns 200 only when its PostgreSQL connection responds, otherwise 503. Clerk authentication is not integrated. Expo customer/admin apps are placeholders; **nothing is deployed**.

## Development

Requirements: Node.js 24, npm 10+. Use `npm ci` from the repository root.

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

The npm workspace layout is `apps/customer`, `apps/admin`, `apps/api`, `packages/shared`, `packages/ui`. Workspace checks cover shared-domain TypeScript, NestJS API HTTP integration tests and core deployment guards, **not** Prisma connectivity, Clerk authentication or Android/Expo builds.

## Design and operations

- [Master implementation plan](docs/plan/MASTER-PLAN.md)
- [Manual deployment recipes: Vercel / VPS API / PostgreSQL](docs/ops/DEPLOYMENT-RUNBOOK.md)
- [VPS incident investigation — read-only](docs/ops/INCIDENT-READONLY.md)
- [Manual GitHub Actions operations and prerequisites](docs/ops/MANUAL-OPERATIONS.md)
- [Frontend QA policy](docs/qa/FRONTEND-QA.md)
- [Agent working agreement](AGENTS.md)

## Release lock

**No automatic deployment.** `vercel.json`, `apps/customer/vercel.json` and `apps/admin/vercel.json` keep `git.deploymentEnabled=false`. Production workflow actions require manual dispatch and explicit target configuration. No application or database has been deployed through this code.

## UI reference

Original eight mockup PNG files are in the repository root. They are concept references, not proof of working application flows, real catalogue prices or actual customer details.

### Locked design references

The eight root PNG mockups are byte-for-byte protected by `npm run ui:reference:check` in both PR CI gates. Changing, removing or renaming any reference fails CI. Any intentional revision must be a dedicated, reviewed asset PR that documents the design decision and explicitly updates the locked Git blob IDs. This protects source images; it does **not** replace visual comparison, mobile/PWA testing or the mandatory frontend QA skill.
