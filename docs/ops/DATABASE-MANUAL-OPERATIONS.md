# Initial database release: backup, restore and independent migration

This extends PR #19. No application migration or API activation is authorized by
this document. All workflows are `workflow_dispatch` only, protected main only,
and share the API release concurrency group. PostgreSQL remains loopback-only.

## Recovery setup and first backup

`production-db` requires the owner reviewer, main-only branch policy, existing
trusted SSH pin/key and VPS variables. `HOTPOT_MIGRATIONS_ENABLED=false` is the
default. Recovery identities/database passwords are never GitHub secrets.

Install the reviewed LF helpers on the VPS separately; the workflow verifies the
installed DB helper digest against its exact main source and refuses drift.
`age` must be installed. Initialize once using
`scripts/ops/initialize-backup-windows.ps1` with local parameters for the existing
SSH identity, verified server and operator-approved backup directory. Do not put
local paths into Git. The script locks the directory to the current Windows SID,
captures an age recovery identity in memory, persists it protected by Windows
DPAPI, and installs **only its public recipient** into root-owned mode-0600
`/etc/sichuan-hotpot/backup.json`. It preserves an existing recovery identity.

Dispatch `BACKUP` with exact current-main SHA and `BACKUP_DB`. The helper requires
an inactive API, no current release, no DB clients and an empty initial schema.
It pipes custom-format `pg_dump` directly into age encryption: no plaintext dump
is written. Root-only encrypted backup and pending proof remain on VPS; a
mode-0600 encrypted export is readable by the authorized SSH operator. Actions
prints only backup ID/checksum/status; it uploads no DB artifacts.

Run `scripts/ops/verify-backup-windows.ps1` with that ID/checksum and the approved
local directory. It downloads ciphertext over pinned SSH, checks SHA256, then
uploads the **offsite copy** for the drill. It unprotects the DPAPI identity in
memory and sends it through SSH stdin. The VPS uses a private root-only `/run`
temporary identity, removes it when finished, and restores into a newly named
`hotpot_restore_*` database using a restricted transient role. No production DB
is ever a restore target. Schema and table-count fingerprints must match the
original, and production must remain unchanged. The restore DB is retained;
PUBLIC CONNECT is revoked and its owner is returned to NOLOGIN/password NULL.
Only then is the root-only proof marked offsite/restore verified. A local receipt
records ID/checksum/time, without customer data or key material.

DPAPI recovery needs the same Windows user/profile; one Windows disk is not a
complete disaster recovery solution. An independently protected offline recovery
identity and a second encrypted backup copy are still required for host-loss
recovery. Do not export recovery secrets through chat or GitHub. No automatic
retention/deletion is implemented; retained copies/drill DBs need operator review.

## Reviewable migration source and separate approval

1. Dispatch `PREPARE_MIGRATION`, exact current-main SHA and matching confirmation.
   It builds the locked source without production credentials, validates the
   allowlisted archive and freezes a root-only source on VPS. It prints the
   digest for review and **does not run SQL**. Existing staged sources are never
   overwritten. The backend release workflow does not run production migrations.
2. Review the two existing migration SQL files, locks, compatibility and recovery
   plan. This helper supports **only the initial empty Hotpot database**, not
   subsequent migrations or an active service. Do not reuse it for later schema
   changes. The isolated CI drill runs the complete helper against disposable
   PostgreSQL, including encryption, restore, least-privilege Prisma execution,
   drift checks and credential revocation.
3. After separate operator approval, create root-owned mode-0600
   `/etc/sichuan-hotpot/migration-approval.json` with this non-secret structure:

   ```json
   {
     "sha": "<exact main SHA>",
     "digest": "<staged archive SHA256>",
     "backup_id": "<verified backup ID>",
     "confirmation": "MIGRATE_INITIAL_HOTPOT",
     "ticket": "<approved change reference>",
     "approved_by": "<operator identifier>",
     "window_start": 0,
     "window_end": 0
   }
   ```

   Replace times with approved UTC Unix seconds; window must be at most one hour.
   No approval file is created by provisioning or by a backup workflow.
4. Backup must match SHA, be at most two hours old, have checksum/offsite/restore
   proof and still match the current DB fingerprint. Enable migrations explicitly,
   dispatch `MIGRATE_INITIAL` with SHA/backup ID/confirmation, then approve the
   independent `production-db` Environment. Disable migration enablement afterward.
5. The helper consumes approval/proof **before** execution. A restricted transient
   LOGIN member of NOLOGIN `hotpot_owner` runs Prisma as non-root with `role`
   connection options. Its password is generated on VPS and used only in process
   environment. Role membership/login/password are revoked in `finally`; a hard
   kill/host crash still requires an operator credential audit before retry.
6. Verify exact migration history, read-only app access to `_prisma_migrations`,
   schema diff and empty User/Order reconciliation. API remains inactive. Failure
   never resets/down-migrates/restores production automatically; approval is
   already consumed. Inspect sanitized fixed codes and approve fix-forward or
   recovery separately. Do not delete failed releases/drill DBs automatically.

No production migration has been executed while implementing this workflow.
First deployment still needs real API domain/DNS/TLS, recent verified backup,
separate migration approval/window, successful migration/reconciliation and an
independently approved API release. Live/ready/auth smoke on production remain
NOT TESTED until the API actually runs.

The format/restore choices follow [PostgreSQL 16 pg_dump](https://www.postgresql.org/docs/16/app-pgdump.html)
and [pg_restore](https://www.postgresql.org/docs/16/app-pgrestore.html); transient
role selection uses [Prisma PostgreSQL connection options](https://docs.prisma.io/docs/orm/v6/overview/databases/postgresql).
