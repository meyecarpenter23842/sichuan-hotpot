# Hotpot VPS provisioning — 2026-10-12

The approved task uses the owner's existing second SSH identity; no SSH key was
generated. The original audit-only identity is unchanged. Inventory found no
pre-existing application service or PostgreSQL cluster. OS/SSH/cloud-agent
services are outside this change scope.

## Provisioned

- Node.js 24, PostgreSQL 16 and Nginx installed. Package auto-start was temporarily
  blocked; only the new PostgreSQL cluster and private Nginx site were started.
- Database `hotpot`, NOLOGIN owner `hotpot_owner`, and LOGIN role `hotpot_app`.
  The app has CONNECT/schema USAGE/default DML grants, with no superuser,
  CREATEDB, CREATEROLE, replication or schema CREATE privilege.
- PostgreSQL binds only `127.0.0.1:5432`; private Nginx binds `127.0.0.1:8080`.
  No public database listener/firewall opening was added.
- Root-owned `/etc/sichuan-hotpot/api.env`, group `hotpot-api`, mode 0640.
  Database URL, unchanged owner Google Client ID and a separate random JWT secret
  are configured. The existing Google Client Secret requires masked local entry;
  verify presence only, without printing values.
- Versioned release/staging/incoming directories, non-login runtime/build users,
  hardened `hotpot-api.service`, release helper and HTTPS template installed.
  **API inactive, no current pointer activated, zero application tables.**
- GitHub `production-api`: main-only, owner approval, existing deploy-key and
  trusted host-pin Environment secrets. Release-enable remains `false`.

**Backend deployment NOT PERFORMED. Application migration NOT RUN.** No production
orders/customer accounts were created and no deploy workflow was dispatched.

## Manual release contract

Source is in `infra/vps/`. The root-owned executable is
`/usr/local/sbin/hotpot-api-release-manual`:

```sh
sudo /usr/local/sbin/hotpot-api-release-manual --check-config
sudo /usr/local/sbin/hotpot-api-release-manual --verify-archive <exact_sha> <sha256>
sudo /usr/local/sbin/hotpot-api-release-manual --prepare-only <exact_sha> <sha256>
```

These commands never activate/restart the API. Archive validation rejects
traversal, links, devices, secrets, dependencies, duplicates and unexpected files.
Checksum/parsing use one file descriptor. Preparation installs the exact lockfile
as `hotpot-build` with lifecycle scripts disabled, generates Linux Prisma and
checks runtime modules. Prepared releases become root-owned and read-only to
runtime/build accounts. Incomplete preparations are preserved for inspection;
the helper never deletes releases or DB data.

The dispatch-only workflow invokes the helper with exact current-main SHA/digest.
Activation requires protected environment, completed migration history and a real
HTTPS URL; operations serialize, switch `current` atomically and restart only
`hotpot-api.service`. Live/ready checks run against loopback and HTTPS. Failure
restores the previous pointer and verifies health; a failed first release stops
only Hotpot and removes only its current pointer. No migration command is present.

An independently approved rollback is:

```sh
sudo /usr/local/sbin/hotpot-api-release-manual --rollback <exact_existing_sha>
```

Eight helper tests check archive rejection/activation/rollback using temporary
directories and fake service callbacks. CI tests API/auth with disposable PG.
Nginx syntax, systemd unit, DB connection/privileges and Linux artifact preparation
must be verified separately. Production HTTPS/auth health remain NOT TESTED.

## First-release conditions still required

1. Enter the existing Google Client Secret using `scripts/ops/set-google-secret.ps1`
   and verify presence. Its masked prompt sends SSH stdin to the root-owned setter;
   values never enter arguments, history, GitHub or source. The setter atomically
   preserves file permissions and does not restart the API. ID-token verification
   itself does not consume this secret.
2. Supply API hostname, A record to the verified VPS and TLS contact email.
   Remove stale AAAA records unless IPv6 is deliberately configured. Verify DNS
   and approved provider inbound ports 80/443. Obtain a real trusted certificate,
   enable the HTTPS template after `nginx -t`, and set `https_base_url` in protected
   `/etc/sichuan-hotpot/release.json`. No dummy certificate qualifies.
3. Separately approve initial production migrations `20261012000000_init` and
   `20261012010000_auth_identity`, after recent backup, isolated restore proof,
   execution window and reconciliation plan. Use a separately provisioned,
   time-scoped migration credential under `hotpot_owner` so default DML grants
   apply; never grant the app DDL/superuser rights. Revoke INSERT/UPDATE/DELETE on
   `_prisma_migrations` from `hotpot_app`, leaving SELECT only; the release helper
   refuses writable migration history. Verify history and schema drift.
4. Approve exact current-main release, deliberately enable releases, dispatch
   `DEPLOY_API`, approve Environment, then disable release enablement afterwards.
5. Verify live/ready, service/PostgreSQL, 401 and authenticated CUSTOMER 403 using
   an operator-approved test identity; no production orders for smoke tests.

Readiness checks `SELECT 1`; helper checks migration history, not full schema
equivalence. Schema drift requires separate operator verification. Raw runtime
stdout/stderr are suppressed to avoid unsanitized exception/PII output; helper
diagnostics are fixed codes. Further sanitized application observability remains
a production-readiness task. The existing SSH identity retains broad operator
sudo; Environment/main/manual gates do not make it an OS-restricted deploy key.

## Reference

[NPP manual VPS backend workflow](https://github.com/binhnxwjfjxm/NPP-Platform/blob/main/.github/workflows/vps-company-backend-manual.yml)
informed versioned releases, service separation, health checks and rollback.
Hotpot does not adopt its issue-comment trigger or first-seen host-key trust.
