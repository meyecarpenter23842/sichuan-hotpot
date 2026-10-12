# Sichuan Hotpot — working agreement (public-safe)

This repository is for a self-delivery Sichuan hotpot & milk tea shop. Read [the master plan](docs/plan/MASTER-PLAN.md), [deployment runbook](docs/ops/DEPLOYMENT-RUNBOOK.md), and [read-only incident guide](docs/ops/INCIDENT-READONLY.md) before editing.

## Non-negotiable boundaries
- TypeScript stack: Expo/React Native customer Android + iPhone web PWA; separate Expo/React Native admin Android + web PWA; NestJS API, PostgreSQL/Prisma, direct Google OAuth/OIDC + username/password accounts (no Clerk), WebSocket, FCM/Web Push, routing-distance delivery calculation.
- No secrets or local SSH key paths, credentials, .env, production customer data, or personal information in git, logs, screenshots or issues.
- Default behavior: **NO AUTO DEPLOY**. PR CI/tests may run automatically; deployment, production migration, Vercel publish, VPS restart/configuration changes, and rollback require explicit operator approval and manual initiation. Merge does not deploy.
- All changes via task branch -> PR -> required CI green on current HEAD -> human review when configured -> merge. Never push directly to main (after bootstrap), bypass required checks, force main, or overwrite dirty local state.
- Never assume Windows drive, SSH, VPS, Vercel access, or Android emulator is available. Verify before reporting success.
- Monetary amounts integer VND; timestamps UTC; role checks server-side; reprice every checkout and address change; idempotent order placement and audit transitions; distance from real road route, not haversine. Fail closed when route can't be priced.
- No production migration without recent verified backup, restore drill, execution window, explicit approval, and post-migration reconciliation.

## Auth and Neon decision (2026-10-12)
- Google sign-in is direct OAuth/OIDC plus first-party NestJS sessions; local accounts register via unique username and securely hashed password. Do not introduce Clerk. See [ADR-0001](docs/architecture/ADR-0001-google-username-auth.md). The P1.2 DEV schema still contains provisional `User.clerkSubject`; migrate separately before auth.
- Connected Neon is optional isolated DEV/QA only after project/branch ownership confirmation; PostgreSQL on VPS remains production. Never mutate the current Neon default branch based on its name or apparent emptiness. See [ADR-0002](docs/architecture/ADR-0002-neon-dev-policy.md).

## UI and QA
Mandatory guidance: [professional-frontend-qa](.agents/skills/professional-frontend-qa/SKILL.md) and its references. The eight design mockups currently in repo root are **references only**, not evidence of a working product or price catalogue. Login, username registration and recovery UI must match the locked eight original mockups, with screenshot comparisons and PASS/FAIL/NOT TESTED evidence. UI must handle Vietnamese text, 320/360/390/428 widths, keyboard, safe areas, loading/empty/error/offline and permission states, Android emulator and Safari iPhone PWA if available.

## Reporting
State affected files, actual checks (PASS/FAIL/NOT TESTED), PR/CI links, merged?, local synced?, production deployed?, incident risks. Never assert success without evidence.
