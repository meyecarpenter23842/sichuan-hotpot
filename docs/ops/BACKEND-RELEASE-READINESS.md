# Backend release readiness — 2026-10-12

Historical pre-provisioning report. A later owner-approved task found the existing
shell identity and provisioned the VPS; see [current provisioning state](VPS-PROVISIONING.md).

PRs [#16](https://github.com/meyecarpenter23842/sichuan-hotpot/pull/16) and
[#17](https://github.com/meyecarpenter23842/sichuan-hotpot/pull/17) are merged.
This review starts from main `bdd5f14235d08535a211da901a6d878a8432c49d`.
Both main CI workflows passed. This does not establish production readiness.

## Observed blockers

- The available SSH identity authenticates with strict host-key checking, but
  returns the same restricted audit output even for `true`. It cannot execute
  requested inventory commands. No alternate unrestricted identity was used.
- Audit reports the API service as `unknown` and PostgreSQL readiness as
  `not_tested`. Node/PostgreSQL versions, release helper/inbox, release pointer,
  reverse proxy, HTTPS and database migration history are unverified.
- Backend environment configuration is unverified. No secrets were installed,
  Google configuration changed, service restarted or production migration run.
- The original local checkout contains unrelated untracked Android files.
  Work continues in a separate task worktree; those files are preserved.
- Local Docker daemon is unavailable. Database integration tests require the
  disposable PostgreSQL instance in CI; no production database is a substitute.

**Production deployment: NOT PERFORMED.** The release-enable gate remains closed.

## Operator actions to unblock

Provide a separate scoped release identity through a protected local credential
store or the protected `production-api` environment. Keep the existing audit
identity restricted; do not remove its forced-command protection. Verify its
server host-key pin independently before use. No private paths, keys or tokens
belong in repository files, issues or logs.

With the release identity, execute a read-only inventory first. Example commands
below require operator-supplied placeholders; they contain no credentials:

```sh
ssh -i <protected-release-key> -o IdentitiesOnly=yes -o BatchMode=yes \
  -o StrictHostKeyChecking=yes <user>@<verified-host> 'node --version; command -v psql; command -v pg_isready'
ssh -i <protected-release-key> -o IdentitiesOnly=yes -o BatchMode=yes \
  -o StrictHostKeyChecking=yes <user>@<verified-host> 'test -x /usr/local/sbin/hotpot-api-release-manual && test -d /opt/sichuan-hotpot/incoming'
```

Inventory the actual Hotpot service, reverse proxy, TLS hostname, private
PostgreSQL listener and prior immutable release. Review the release helper and
its rollback behavior before invoking it; presence alone is insufficient.
Determine the service's protected environment file without printing its contents.
Read back only whether `DATABASE_URL`, `AUTH_JWT_SECRET` and `GOOGLE_CLIENT_ID`
are valid/present; compare the Google ID privately with the owner's existing ID.
The JWT secret must be independent, high entropy and at least 32 bytes.
Google ID-token verification does not use a Google Client Secret.

In that protected service environment, run `prisma migrate status` against the
release schema and inspect migration history read-only. Required migrations are
`20261012000000_init` and `20261012010000_auth_identity`. If either is pending,
failed or incompatible, stop for separate migration approval plus recent backup,
isolated restore proof, execution window and reconciliation. Never run migrate
deploy as part of API installation, startup or restart.

## Artifact and release acceptance

The manual workflow packages compiled API/shared code, Prisma schema/migrations,
the exact lockfile and all workspace manifests needed by npm. It excludes
frontend source and installed dependencies. A reviewed helper must install from
that lockfile and generate Prisma on the target Linux platform; CI-generated or
Windows-generated engines are not a substitute. It must verify the digest,
validate archive paths, preserve the previous release and avoid DB migration.

Only after all preconditions pass may the approved manual API release run.
Verify HTTPS `/health/live` and `/health/ready`, service state after restart,
unauthenticated/forged-token 401 and authenticated CUSTOMER admin-access 403.
Use an existing operator-approved test identity for authenticated smoke tests;
do not create customer accounts or orders on production for this audit.
Real Google login requires a fresh owner-provided ID token through a secure
channel and must not appear in terminal history or logs.

Current `/health/ready` proves database reachability with `SELECT 1` only. It does
not prove migration compatibility or auth configuration. Check those separately
before release and record exact SHA, digest, prior release and sanitized health
results as required by the deployment runbook.
