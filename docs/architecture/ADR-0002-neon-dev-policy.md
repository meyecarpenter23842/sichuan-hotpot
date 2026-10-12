# ADR-0002: Neon is optional DEV/QA; Hotpot production stays on VPS

Status: ACCEPTED as a safe evaluation policy, 2026-10-12. No Neon writes executed.

## Observations (read-only connector inspection)
- One accessible Neon project was found, running PostgreSQL major version 18.
- It currently has a single default branch named "production"; zero application tables were returned.
- No ownership link to Sichuan Hotpot has been established. An empty database does not authorize schema changes. The default branch name is NOT permission to treat it as a disposable DEV environment.

## Allowed potential project benefits
- After confirming the specific project belongs to Hotpot, use a clearly isolated non-production Neon branch or dedicated DEV/QA project, with synthetic data only.
- Use the connected ChatGPT Neon integration to inspect schemas, review tables, compare isolated branches and help diagnose DEV data-model issues. Do not expose production customer records.
- With separately approved DEV scope, review and apply Prisma migrations in isolated DEV, practice restoring a DEV snapshot and compare schema drift. Store credentials only in protected environment variables; never in GitHub, chat messages or logs.
- Keep GitHub Actions disposable PostgreSQL tests. Neon uses PG18 while current CI uses PG16: verify version compatibility before relying on it as staging.
- Do not move runtime or production database to Neon without a separate explicit infrastructure decision. The existing PostgreSQL on VPS remains the production source of truth. Never run migrations on the Neon default/production branch as a shortcut.

## Implementation preconditions
Confirm project ownership/purpose, isolate branch and user permissions, confirm non-production database name, use limited credentials and cost monitoring, document safe teardown, then request permission for any migration. No production writes or deployments are authorized here.
