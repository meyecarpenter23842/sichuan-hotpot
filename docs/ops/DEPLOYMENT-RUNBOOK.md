# Manual-only deployment and rollback runbook

**STATUS: RECIPE / NOT EXECUTED.** Written for a future NestJS+Prisma API on VPS and two Expo Web PWAs on Vercel. Verify actual stack, paths, service manager, DNS, build scripts and secrets before turning any snippet into an executable production job.

## Golden rules
1. Automated GitHub Actions **CI only** on PR/push. Never deploy on push, PR, merge, tag, issue comment, release publish, Vercel Git hook, EAS automatic update, server-side timer or VPS Git poll.
2. Only a named authorized human initiates each release. Workflow trigger `workflow_dispatch` only with target/environment/exact 40-character commit SHA and change ticket; production GitHub Environment requires reviewer approval. No hidden bypass or pre-approved automation.
3. Deploy credentials stored solely in protected Environment secrets; PR CI gets no SSH/Vercel/DB credentials. Least-privilege service identities and pinned SSH host key fingerprints. Never echo `.env`, tokens, `DATABASE_URL`, private keys.
4. Deploy by immutable artifact/source SHA verified against protected main; lock concurrency per target; record before/after release; smoke-check; rollback independently. Merge != deploy.
5. No PostgreSQL schema change during backend build/start. Migration is a completely separate manual release.

## A. All Vercel Git auto deploys blocked
The **repository root** and each actual Vercel app project root (customer and admin) must contain:
```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "git": { "deploymentEnabled": false }
}
```
Committed permanently as `vercel.json`, `apps/customer/vercel.json` and `apps/admin/vercel.json`. GitHub PR #1 received a Vercel status check pointing to the owner's `sichuan-hotpot` project, so the root-level gate is essential until the provider's configured root directory is verified. The setting disables automatic Git deployments across all branches; **do not** flip it true to deploy, even temporarily. Prefer creating Vercel projects **without Git repository integration**, then linking by CLI and project IDs only. If already integrated, verify the provider respects the permanent gate; check both production and preview behavior using a harmless CI-only commit (do not intentionally trigger production). Provider-linked configuration is not yet verified for the owner's requested Vercel scope.

Manual frontend procedure (illustrative; exact packages/scripts to finalize in bootstrap):
1. Approve protected `production-customer-pwa` or `production-admin-pwa` GitHub Environment; record repo, target project and SHA.
2. Checkout exact protected `main` SHA; assert `origin/main` equals requested SHA and `vercel.json` contains false; run lint, TS, tests, Expo Web export. Never inject DB credentials into browser app.
3. Use an authorized deploy runner with selected Vercel `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`; verify project readback matches account/root dir; use CLI, for example `vercel pull --yes --environment=production` then `vercel deploy --prod` **from correct app root** (or `vercel build --prod` + `vercel deploy --prebuilt --prod` if build strategy validated). Do **not** use a Git push as release trigger.
4. Check provider returned deployment ID/URL and correct immutable SHA, PWA manifest/service worker/icons, homepage/menu/admin unauth routes, authenticated gates, static assets, API connectivity, Safari install/push prerequisites; only then report READY.
5. Failure: no blind retry; diagnose build/runtime; roll back to previous verified deployment via explicitly approved manual Vercel rollback/promotion procedure; verify alias readback. Restore settings as needed, never toggle Git deploymentEnabled.

## B. Backend VPS: manual artifact release (no auto service pulls)
Preflight (read-only): SSH with pinned known_hosts; identify actual user, service manager, install root, reverse proxy, TLS cert, runtime port, existing release SHA and health endpoints. Capture sanitized before-state and DB connectivity; never assume process names. Validate health `/health/live`, `/health/ready` on TLS domain.

Backend deploy manual sequence:
1. Protected environment approval for exact main SHA and target release.
2. CI builds/tests API and creates immutable artifact with digest/SBOM (or reproducible release archive); do not pack `.env`, key files, local mounts or `node_modules` unnecessarily.
3. Backup current release artifact/config references (not raw secrets), verify free space/ownership and no new schema requirement without separately approved migration.
4. Securely transfer artifact to a **new versioned release directory** under an allowlisted path; integrity-check digest and dependency provenance. Do not edit other apps on shared VPS.
5. Run production build/install on prepared release if required. Make service point to versioned release **atomically** using established manager after backup; restart only this service as part of explicit approved deploy. Do not run `prisma migrate deploy` in startup hooks.
6. Health live/ready, auth 401/403, menu GET, order API safe smoke, WebSocket connect, database read permissions and worker/outbox; monitor sanitized logs for controlled period; mark release only after checks.
7. Failure: rollback symlink or manager to last verified release, restart *approved* service and re-run health. If DB schema has changed incompatibly, stop and invoke separate DB recovery plan, not blind rollback.

## C. PostgreSQL/Prisma: manual migration gate
There is **no automatic database deployment** on CI, API startup, app release or cron. DB hosted in VPS private/loopback network; no Internet-wide port 5432. Required workflow `workflow_dispatch` with migration ID, exact source SHA, backup ID, maintenance window, approval and restricted DB credentials.
1. Check live schema/migration history in **read-only** mode; inspect SQL diff, backwards compatibility, locks/size, rollback/data transform and estimate outage.
2. Take fresh `pg_dump` or provider-backed consistent snapshot with checksum, encryption, retention and storage separate from same VPS; do not put dump in Actions artifact or GitHub. Verify restore *in isolated non-production database* and record proof.
3. Confirm approved window, idempotency/migration ordering and free space. Establish a single migration executor; coordinate app compatibility and write traffic. Stop if backup/restore proof missing.
4. Run `prisma migrate deploy` **only** through manual scoped migration job using protected production credentials, after the explicit owner approval.
5. Verify migration table, schema invariants, row counts/reconciliation, critical read/write flows, latency and backup status; record version/SHA/time.
6. Rollback policy: code downshift only if schema remains compatible; avoid `prisma migrate reset` or automatic down SQL in prod. Destructive schema rollback requires restore/fix-forward decision and explicit operator approval.

## D. Android releases
Build via local Android Studio/Expo EAS or a separately approved manual build pipeline; `eas build` and store distribution must never run from push/merge. Test APK/AAB on emulator and real device, verify release signing via protected secrets, choose human-controlled upload/distribution. No EAS Update auto-publishing; production OTA update only manual with version/channel controls.

## E. Rollback/release matrix
| Target | Manual trigger | Backup/previous release | Smoke | Rollback boundary |
|---|---|---|---|---|
| customer-pwa | protected dispatch | prior verified Vercel deployment | iPhone home/menu/checkout + manifest | Vercel prior deployment |
| admin-pwa | protected dispatch | prior verified Vercel deployment | login/roles/queue/WS | Vercel prior deployment |
| api-vps | protected dispatch | prior release artifact | live/ready/auth/order | approved API previous artifact |
| database-vps | separately approved dispatch | encrypted fresh backup + restore rehearsal | schema/order totals | explicit recovery decision |
| android-apks | manual build/release | signed previous artifact | emulator/real device | controlled app distribution |

## F. Required operator checklist
Record `ticket | requester | approver | exact SHA | artifact digest | target | before health | backup ID | release ID | after health | rollback ID | result`; separate each subsystem, do not co-deploy on merge. All deployments start DISABLED/NOT RUN until scope/account credentials and real service discovery are complete.

## Reference
- [NPP production control](https://github.com/binhnxwjfjxm/NPP-Platform/blob/main/docs/operations/vercel-manual-deployment-control-2026-07-27.md): permanent `git.deploymentEnabled=false`, manual Vercel CLI (avoid past toggle-and-push issue).
- [NPP backend manual workflow](https://github.com/binhnxwjfjxm/NPP-Platform/blob/main/.github/workflows/vps-company-backend-manual.yml): immutable SHA/versioned release concepts, not its production environment.
- [NPP database migration workflow](https://github.com/binhnxwjfjxm/NPP-Platform/blob/main/.github/workflows/vps-production-migration-164-manual.yml): independent backups/restore/migration concept.
- [Vercel Git config](https://vercel.com/docs/project-configuration/git-configuration).
