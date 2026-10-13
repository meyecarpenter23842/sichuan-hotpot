# P3 production: private R2 backup + owner comment release

## Verified destination

- Cloudflare account: same verified account as media bucket hot-pot.
- Backup bucket: hotpot-db-backups-private, Standard/APAC, created 2026-10-13.
- Cloudflare API confirmed public r2.dev domain DISABLED and no public custom domains.
- Database exports MUST NOT use the public hot-pot bucket.

## One-time VPS setup (owner terminal, no Windows recurring steps)

1. Cloudflare Dashboard > R2 > Manage R2 API Tokens. Create object Read/Write credentials scoped ONLY to hotpot-db-backups-private. Keep access key and secret private; never put either in GitHub, chat, an .env commit or logs.
2. After CI PASS and PR merge, fetch exactly the protected-main commit source, including setup script, P3 helper and current API release helper. Prefer an immutable SHA URL. The commands below must be run ON the VPS by the operator, not in Actions.
3. Replace FULL_MERGED_MAIN_SHA with the exact 40-character SHA reported after merge:

```bash
set -euo pipefail
SHA=FULL_MERGED_MAIN_SHA
[[ "$SHA" =~ ^[a-f0-9]{40}$ ]] || exit 1
base="https://raw.githubusercontent.com/meyecarpenter23842/sichuan-hotpot/$SHA"
curl -fsSLo /tmp/hotpot-p3-setup.sh "$base/scripts/ops/setup-p3-r2-vps.sh"
curl -fsSLo /tmp/hotpot-p3-operations.py "$base/infra/vps/hotpot-p3-operations.py"
curl -fsSLo /tmp/hotpot-api-release-manual.py "$base/infra/vps/hotpot-api-release-manual.py"
python3 -m py_compile /tmp/hotpot-p3-operations.py /tmp/hotpot-api-release-manual.py
sudo install -o root -g root -m 0755 /tmp/hotpot-p3-operations.py /usr/local/sbin/hotpot-p3-operations
sudo install -o root -g root -m 0755 /tmp/hotpot-api-release-manual.py /usr/local/sbin/hotpot-api-release-manual
sudo bash /tmp/hotpot-p3-setup.sh
rm -f /tmp/hotpot-p3-setup.sh /tmp/hotpot-p3-operations.py /tmp/hotpot-api-release-manual.py
```

The install intentionally does NOT restart or migrate production. The GitHub release job verifies the installed helper SHA256 against source on protected main before it allows production SQL.

The setup script prompts for R2 keys in the SSH terminal only; stores credentials in root-only /etc/sichuan-hotpot/p3-rclone.conf, checks the private R2 bucket, generates a root-only age key for automated isolated restore, and refuses to enable releases without explicit SAVED_OFFSITE acknowledgement. Save the age recovery identity independently OFF the VPS (password manager or offline safe), or an R2 backup could be irrecoverable if the VPS is lost. Do NOT paste it into chat or Github. Leave existing Windows backups untouched until the first new R2 backup+restore passes.

## Owner-only comment deployment

At https://github.com/meyecarpenter23842/sichuan-hotpot/issues/3:

- /release-hotpot-p3 : test current main against a disposable CI PostgreSQL, package exact SHA, verify VPS helper hashes, create encrypted pg_dump, upload to private R2, download from R2, SHA256 verify, decrypt/restore to an isolated DB, verify core tables, apply only the two additive P3 Prisma migrations, verify schema/history, release NestJS API with its existing health/rollback helper.
- /deploy-hotpot-customer : ONLY after the P3 backend workflow succeeds; existing manual Vercel workflow publishes the PWA.

Both comments are accepted only from owner meyecarpenter23842 on Issue #3. Merge does NOT trigger production deploy. Existing first-release /migrate-hotpot workflow is NOT suitable for the running database and must not be used.

## Limitations / recovery

- Initial configuration requires a Cloudflare R2 bucket-limited access/secret pair entered privately ON the VPS once. ChatGPT cannot read the values, and they should never be sent here.
- Encrypted backup objects and isolated restore DBs are retained; automatic deletion is not implemented. Periodically inspect retention and costs.
- Running production API stays available during pg_dump; new orders may arrive after snapshot. The isolated restore proves a consistent snapshot can actually be restored, not that it includes subsequent transactions.
- If any step before migrations fails, the backend is not deployed. If migration succeeds but API activation fails, inspect protected VPS diagnostics; do not restore DB blindly. Additive nullable columns preserve compatibility with the previous API.
- Production Google Routes and VietQR must still be configured in the backend protected environment for real delivery quote/QR functionality. No smoke PASS is claimed before actual release.
