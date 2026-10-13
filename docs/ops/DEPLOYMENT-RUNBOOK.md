# Owner-command deployment and rollback runbook

**STATUS: RECIPE / NOT EXECUTED.** Written for a future NestJS+Prisma API on VPS and two Expo Web PWAs on Vercel. Verify actual stack, paths, service manager, DNS, build scripts and secrets before turning any snippet into an executable production job.

## Existing VPS and Vercel Environment credentials — one-time GitHub review setting (2026-10-13)

**Root cause:** PR #28 removed GitHub `environment:` from production release jobs to avoid reviewer pauses. This also removed access to already configured **Environment-level SSH/VPS variables**, so the new `/backup-hotpot` run failed before executing with missing `VPS_HOST`, `VPS_USER` and `VPS_PORT`.

**Fix:** restore each job's original Environment, preserving its existing secrets/vars and the owner-only exact command, protected main SHA, strict SSH pins, concurrency and backup/restore gates. The owner only needs **one GitHub Settings adjustment per Environment** to disable `Required reviewers` (not secrets, variables or the workflows). The reviewer setting is not a YAML field.

1. Open **https://github.com/meyecarpenter23842/sichuan-hotpot/settings/environments** and select **production-api**.
2. In **Deployment protection rules**, remove/uncheck **Required reviewers**, and save. Do not delete the Environment or any existing secrets/variables.
3. If owner-command customer/admin PWA release also requests review, repeat once for **production-customer-pwa** / **production-admin-pwa**. Legacy workflow-dispatch DB operations use **production-db**, so disable reviewers there only if that workflow is used and requires them.
4. On Issue #3 the owner posts `/backup-hotpot`, waits for an actual backup PASS, verifies independent encrypted offsite+isolated restore proof, then `/migrate-hotpot` and `/deploy-hotpot` under the existing VPS helper contract. No fresh credential setup should be necessary if the Environment values remain configured.

**Security:** GitHub required reviewers protect actions and cannot be overridden with YAML. No tool access is available here to edit GitHub Environment Settings; the owner must make this one-time UI change. Existing waiting runs must not be force-approved/bypassed; only cancel a verified non-executed stale run. No new production migration/deploy is implied by this workflow fix.

## Golden rules
1. Automated GitHub Actions **CI only** on PR/push. Never deploy on push, PR, merge, tag, arbitrary issue comments, release publish, Vercel Git hook, EAS automatic update, server-side timer or VPS Git poll. Exact authorized owner-only operational comments on Issue #3 are explicit manual commands, as in NPP.
2. Only the repository owner initiates each operation, using exact /deploy-hotpot, /backup-hotpot or /migrate-hotpot on Issue #3, or the legacy manual workflow_dispatch. Issue commands infer the current protected main SHA automatically. Owner-only operational jobs bind to existing GitHub Environments to read already configured secrets and variables. The owner disables Required reviewers once on the relevant Environment in GitHub Settings. Existing waiting jobs are not retrospectively unblocked by YAML changes.
3. Deploy credentials stay in existing GitHub Environment secrets/variables; PR CI does not reference these Environments. Least-privilege service identities and pinned SSH host key fingerprints. Never echo `.env`, tokens, `DATABASE_URL`, private keys.
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
1. Owner posts `/deploy-hotpot-customer` or `/deploy-hotpot-admin` on Issue #3. The workflow resolves the current protected main SHA and target Environment automatically. This owner-command job uses the preconfigured customer/admin Environment; disable Required reviewers there once to avoid repeat approvals.
2. Checkout exact protected `main` SHA; assert `origin/main` equals requested SHA and `vercel.json` contains false; run lint, TS, tests, Expo Web export. Never inject DB credentials into browser app.
3. Use an authorized deploy runner with selected Vercel `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`; verify project readback matches account/root dir; use CLI, for example `vercel pull --yes --environment=production` then `vercel deploy --prod` **from correct app root** (or `vercel build --prod` + `vercel deploy --prebuilt --prod` if build strategy validated). Do **not** use a Git push as release trigger.
4. Check provider returned deployment ID/URL and correct immutable SHA, PWA manifest/service worker/icons, homepage/menu/admin unauth routes, authenticated gates, static assets, API connectivity, Safari install/push prerequisites; only then report READY.
5. Failure: no blind retry; diagnose build/runtime; roll back to previous verified deployment via explicitly approved manual Vercel rollback/promotion procedure; verify alias readback. Restore settings as needed, never toggle Git deploymentEnabled.

## B. Backend VPS: manual artifact release (no auto service pulls)
Preflight (read-only): SSH with pinned known_hosts; identify actual user, service manager, install root, reverse proxy, TLS cert, runtime port, existing release SHA and health endpoints. Capture sanitized before-state and DB connectivity; never assume process names. Validate health `/health/live`, `/health/ready` on TLS domain.

Backend deploy manual sequence:
1. Owner enters `/deploy-hotpot` on Issue #3; the workflow resolves and checks exact main SHA. The owner-only GitHub workflow reads existing Environment credentials; Required reviewers must be switched off once in GitHub Settings for zero-repeat approval. No second application-level confirmation is needed.
2. CI builds/tests API and creates immutable artifact with digest/SBOM (or reproducible release archive); do not pack `.env`, key files, local mounts or `node_modules` unnecessarily.
3. Backup current release artifact/config references (not raw secrets), verify free space/ownership and no new schema requirement without separately approved migration.
4. Securely transfer artifact to a **new versioned release directory** under an allowlisted path; integrity-check digest and dependency provenance. Do not edit other apps on shared VPS.
5. Run production build/install on prepared release if required. Make service point to versioned release **atomically** using established manager after backup; restart only this service as part of explicit approved deploy. Do not run `prisma migrate deploy` in startup hooks.
6. Health live/ready, auth 401/403, menu GET, order API safe smoke, WebSocket connect, database read permissions and worker/outbox; monitor sanitized logs for controlled period; mark release only after checks.
7. Failure: rollback symlink or manager to last verified release, restart *approved* service and re-run health. If DB schema has changed incompatibly, stop and invoke separate DB recovery plan, not blind rollback.

## C. PostgreSQL/Prisma: manual migration gate
There is **no automatic database deployment** on CI, API startup, app release or cron. DB hosted in VPS private/loopback network; no Internet-wide port 5432. Required workflow `workflow_dispatch` with migration ID, exact source SHA, backup ID, maintenance window, approval and restricted DB credentials.
1. Initial empty-schema migration: owner enters `/migrate-hotpot` on Issue #3. The workflow stages exact current main and uses the command as single-use approval on VPS only if a recent, **already independently verified offsite backup and isolated restore proof** exist. Later migrations require their own reviewed helper; do not reuse the first-release-only command. Check live schema/migration history and compatibility.
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
