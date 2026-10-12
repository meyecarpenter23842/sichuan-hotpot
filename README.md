# Sichuan Hotpot — Lẩu Tứ Xuyên & Trà Sữa

**Status: P0 bootstrap in progress — not production ready.** Shared delivery policy and order status domain logic now have TypeScript implementations and tests. NestJS API and Expo customer/admin apps are placeholders, **not deployed apps**.

## Development

Requirements: Node.js 24, npm 10+. Use `npm ci` from the repository root.

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

The npm workspace layout is `apps/customer`, `apps/admin`, `apps/api`, `packages/shared`, `packages/ui`. P0 checks currently cover shared-domain TypeScript and core deployment guards, **not** Android/Expo builds or NestJS integration; dedicated Expo/NestJS scripts will be added when those apps are bootstrapped.

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
