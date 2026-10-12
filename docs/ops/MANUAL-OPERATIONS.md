# Sichuan Hotpot — Manual Operations (GitHub Actions)

**State:** The original scaffolding baseline below is historical. NestJS/Prisma/auth now exist; an owner-approved task has provisioned runtime, private database, systemd/helper and protected `production-api`. Backend activation, initial production migrations and HTTPS are still blocked. See [VPS provisioning](VPS-PROVISIONING.md) for actual checks and first-release conditions.

## Source model: NPP-Platform
Reference [NPP manual VPS audit](https://github.com/binhnxwjfjxm/NPP-Platform/blob/main/.github/workflows/vps-production-audit-manual.yml), [backend release](https://github.com/binhnxwjfjxm/NPP-Platform/blob/main/.github/workflows/vps-company-backend-manual.yml), [production migration](https://github.com/binhnxwjfjxm/NPP-Platform/blob/main/.github/workflows/vps-production-migration-164-manual.yml), and [Vercel release](https://github.com/binhnxwjfjxm/NPP-Platform/blob/main/.github/workflows/vercel-production-manual.yml). Replicate immutable SHA checks and explicit manual operation, **not** NPP's `issue_comment` triggers, implicit `ssh-keyscan` trust, NPP service names, credentials or production resource paths.

## Workflows and current availability

| File | Manual input | GitHub Environment | Current capability |
|---|---|---|---|
| `vps-audit-readonly.yml` | `AUDIT` | `vps-readonly` | Can run after dedicated SSH credentials, verified host key and environment are configured |
| `vercel-pwa-release-manual.yml` | app, exact main SHA, `DEPLOY_PWA` | `production-customer-pwa` or `production-admin-pwa` | Locked: requires bootstrapped PWA and explicit enable |
| `vps-api-release-manual.yml` | exact main SHA, `DEPLOY_API` | `production-api` | Locked: requires NestJS build and reviewed versioned-release VPS helper |
| `vps-db-backup-manual.yml` | ticket, `BACKUP_DB` | `production-db` | Locked: requires vetted offsite/restore-tested VPS backup helper |
| `vps-db-migrate-manual.yml` | exact main SHA, backup ID, restore proof, `MIGRATE_DB` | `production-db` | Locked: requires Prisma migrations + vetted migration helper and actual offsite restore evidence |

All five workflows have **only `workflow_dispatch`** and only run on `main`; they do not deploy, migrate, connect or audit on Git push/PR/merge/comments, tags, a clock, or any incident alert. PR CI validates that this remains true. Each release is serialized by `concurrency`; DB backup/migration and API deployment use the same VPS-change lock.

**Important:** A workflow_dispatch job executes when a human initiates it. `environment` alone does not necessarily create a human reviewer approval gate. GitHub protected Environment reviewers must be enabled if supported; if a repository owner is the only approver and rules disallow self-approval, choose a permitted approval path before using releases. The typed confirmation, verified main SHA, release-enable flag and separate secrets protect from accidental publication, but they are not equivalent to a second person reviewing the change.

## Stage A — Safe read-only VPS inspection

User confirmed SSH login is `ubuntu`. No root SSH is used. Ask operator to confirm SSH port, host-key fingerprint **out-of-band**, whether `ubuntu` is restricted, whether PostgreSQL is local, and the actual systemd service name. A publicly accessible port should be **SSH only**, not public PostgreSQL.

Create GitHub Environment [vps-readonly](https://github.com/meyecarpenter23842/sichuan-hotpot/settings/environments) and restrict deployment branch to `main`.

| Key | GitHub type | What to enter |
|---|---|---|
| `VPS_HOST` | Environment Variable | VPS public hostname or IP, privately configured in GitHub; **not hardcoded in public repository** |
| `VPS_PORT` | Environment Variable | Verified SSH TCP port (often 22; don't assume) |
| `VPS_USER` | Environment Variable | `ubuntu` |
| `VPS_SERVICE_NAME` | Environment Variable | Verified Hotpot service unit (no arbitrary shell metacharacters); only after deployed |
| `VPS_AUDIT_SSH_KEY` | Environment Secret | **Dedicated audit-only private key**; never the existing production deploy key |
| `VPS_KNOWN_HOSTS` | Environment Secret | Exact SSH known_hosts line pinned to the **independently verified** server host key, including bracketed host+port for non-22 |

Create a dedicated audit SSH identity via operator-controlled provisioning (not GitHub CI). Strongest protection: a dedicated unprivileged read-only Linux account, forced command allowlist in `authorized_keys`, and no `sudo`. For the requested `ubuntu` user, workflow commands are non-mutating but **cannot be OS-enforced read-only if that user's remote account has broad write/sudo rights**. This is a security limitation to resolve before treating it as an audit-grade boundary. Do not use root or add permanent sudo privileges for auditing.

**Run manually:** GitHub → Actions → **VPS audit (read-only; manual)** → Run workflow → branch `main` → confirm `AUDIT`. On success it prints only OS family, days uptime, root disk percent, available RAM MB, service active state and local PostgreSQL TCP readiness. SSH failures, host details, database errors and application logs remain suppressed. A local-only PostgreSQL instance may be ready even if `pg_isready` reports not_ready_or_restricted, depending on bind configuration. This workflow does not dump DB rows or customer details.

## Stage B — Vercel PWA manual production release

Existing Vercel projects:
- `sichuan-hotpot-customer`: root `apps/customer`; use GitHub Environment `production-customer-pwa`.
- `sichuan-hotpot-admin`: root `apps/admin`; use `production-admin-pwa`.

Both environments already have `VERCEL_ORG_ID` + their respective `VERCEL_PROJECT_ID` variables and `VERCEL_TOKEN` secret entered by owner. Token validity not tested. Never copy token into repository or logs.

After P0/P2 builds exist, introduce a pinned Vercel CLI as workspace devDependency and verify web export paths. Test on a protected **staging** target before authorizing production. Set `HOTPOT_RELEASES_ENABLED=true` only for a deliberately approved release and revert to false after the release. Run workflow manually, choose app and type exact current protected `main` SHA plus `DEPLOY_PWA`. It read-verifies Vercel account/project/root/no Git integration; fails if linked Git is detected. It runs lint/typecheck/test, Expo Web export, `vercel pull`, `vercel build --prod`, then `vercel deploy --prebuilt --prod`. Verify result in Vercel and smoke app; automatic Git deploy remains disabled.

## Stage C — NestJS Backend: pre-provisioned manual release contract

Create [production-api](https://github.com/meyecarpenter23842/sichuan-hotpot/settings/environments) restricted to `main`.

| Variable/Secret | Scope | Notes |
|---|---|---|
| `VPS_HOST`, `VPS_PORT`, `VPS_USER` | Environment vars | Same verified host; `VPS_USER=ubuntu`, NOT root |
| `VPS_KNOWN_HOSTS` | Environment secret | Validated host-key pin |
| `VPS_DEPLOY_SSH_KEY` | Environment secret | Different from audit key, restricted release key |
| `HOTPOT_RELEASES_ENABLED` | Environment variable | Default absent / `false`; only `true` after P0/P1/ops provisioning |

Pre-provision `/opt/sichuan-hotpot/incoming` writeable only by release identity, and reviewed executable `/usr/local/sbin/hotpot-api-release-manual`, installed **outside of GitHub Actions** after VPS discovery and an approved change. The helper takes `<exact_sha> <sha256>` and must: validate 40-character SHA, checksum archive `hotpot-api-<sha>.tgz`, reject symlinks/path traversal, verify allowlisted service/path, ensure Node and production env prepared, unpack into **new immutable release directory**, verify dependencies, atomically switch release pointer, restart **only** approved Hotpot service, check HTTPS live/ready, preserve prior release and emit sanitized release ID; on failure restore previous release under explicit operator-approved rollback rule. No schema migration or `.env` output in this helper. Never install helper blindly without knowing actual service manager.

The NestJS API, Prisma schema, compiled entry point and npm lockfile now exist in main. The manual release workflow uses a **disposable PostgreSQL 16 service inside its own GitHub Actions job**, applies migrations to that disposable database only, checks schema drift, runs the real root lint/typecheck/test/build scripts and packages an exact-SHA artifact. The API release workflow **does not** migrate the VPS database. Production remains blocked until the helper/inbox and scoped deployment access are independently verified, production backup/restore is rehearsed, and app auth/operations are accepted. No operator should set `HOTPOT_RELEASES_ENABLED=true` just because CI passed.

Before a production auth deployment, configure `GOOGLE_CLIENT_ID` and a new independent high-entropy `AUTH_JWT_SECRET` in the **VPS service's protected backend environment**, never in code, logs or browser apps. Direct Google ID-token verification does **not** consume a Google Client Secret. If the owner separately selects an OAuth authorization-code exchange requiring that secret, only then add `GOOGLE_CLIENT_SECRET` to the correct backend service environment; the existing secret must not be copied to Vercel customer/frontend. Do not claim these VPS environment variables have been installed without actual server readback (values must remain hidden).

## Stage D — PostgreSQL manual backup and migration

Create `production-db` with `VPS_HOST`, `VPS_PORT`, `VPS_USER=ubuntu`, `VPS_KNOWN_HOSTS`, `VPS_DB_MAINTENANCE_SSH_KEY`, and `HOTPOT_RELEASES_ENABLED=false`.

VPS operator must first install and review **two** separately permissioned helpers, only after verifying actual PostgreSQL version/database names, DB role privileges, backup location, encryption, offsite transfer, retention and isolated restore rehearsal:
- `/usr/local/sbin/hotpot-db-backup-manual <ticket>`: create a consistent encrypted dump/snapshot, store offsite, checksum, perform **isolated** restore test, write durable backup ID + restore evidence privately; fail if any step fails. Never attach database dumps to public GitHub Actions artifacts.
- `/usr/local/sbin/hotpot-db-migrate-manual <sha> <backup_id> <restore_proof>`: independently verify immutable backup + genuine restore proof, source release/schema compatibility, exclusive DB migration lock, production maintenance window and operator approval; execute only the reviewed Prisma migration release and validate; never call reset/force/drop or unapproved down migration.

A text input named backup_id/restore_proof **does not itself prove** a backup is valid; the on-VPS helper must verify independently. Until these helpers exist and are reviewed, workflows **fail safely**. Do not store production `DATABASE_URL` in GitHub Actions when an on-VPS restricted role suffices.

## Release readiness / forbid automatic changes
- No auto deploy from Vercel Git, EAS updates, GitHub issue comments, push/merge/tag, VPS cron or startup hook.
- Existing root, customer, admin `vercel.json` have `git.deploymentEnabled=false` permanently.
- Required PR check `plan-and-vercel-lock` includes new manual workflow syntax/control validation.
- Never report QA/backup/restore/SSH as PASS until **actually run and verified**.
- A CI success only certifies configuration files, NOT connectivity to VPS, valid secrets, running backend, backups or production release readiness.
- No SSH key, `.env`, client data, database dump, IP or internal private network diagram in repository logs or issues.
