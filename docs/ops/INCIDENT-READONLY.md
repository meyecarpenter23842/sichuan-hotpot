# VPS incident response: READ-ONLY FIRST

**No incident is being investigated now. No SSH session was opened.** This runbook authorizes nothing by itself. Use only after an explicit operator request to inspect an incident, and only against the specific confirmed VPS and service.

## Incident severity / safe boundary
Record symptom, time UTC, customer impact, recent release SHA, service name and approved on-call contact. Begin with public health probes and platform logs. Next, if separately authorized, connect to VPS for **read-only diagnosis**. Never automatically restart services, reboot VPS, restart DB, change firewall, install software, remove files, redeploy, roll back or run migrations on an alert. Reading diagnostics is not permission to modify anything.

## Read-only checklist (substitute actual verified service names)
1. Client/API probes: HTTPS `/health/live`, `/health/ready`, DNS resolution, TLS expiry, HTTP 4xx/5xx distribution, latency and routing upstream availability. Use request limits.
2. Host: `date -u`, `uptime`, `df -h`, `free -h`, `ss -lnt`, `systemctl is-active <verified-service>`, `systemctl status <verified-service> --no-pager`. Avoid dumping full environment or process command lines with secrets.
3. Logs: `journalctl -u <verified-service> --since '<timestamp UTC>' -n 100 --no-pager` read **locally**; review and redact credentials/PII **before** sharing findings. If containerized, use equivalent bounded `docker logs --tail 100` only after confirming actual runtime.
4. DB checks restricted to non-mutating views with least-privilege read account: `SELECT now();`, `SELECT count(*) FROM pg_stat_activity;`, `SELECT version();`; check storage, connection exhaustion, replication and lock summary without exposing raw SQL/customer data. Never query full user/customer/order tables for public logs.
5. Release cross-check: compare expected SHA from GitHub/manifest to deployed SHA if exposed by a safe health or release manifest endpoint; correlate errors to latest operator-approved deploy or migration.
6. Create sanitized diagnostic report: symptoms, UTC timeline, command **names** without credentials, findings and confidence, safe next actions, no raw key material, SQL dumps, private addresses or phone numbers.
7. Stop at diagnosis. Propose smallest correction + risk + rollback, ask explicit authorization for any mutation. If authorization not given, leave production unchanged.

## Access and secret policy
- Private SSH key remains solely in operator-protected local path/approved secret store; never copy into git, issue, chat, run output, or unprotected CI.
- Pinned SSH host-key fingerprint and constrained authorized user; verify against out-of-band trusted fingerprint, not first-seen `ssh-keyscan` alone.
- Prefer a dedicated read-only or restricted account, not general root. No `sudo` writes or silent privilege elevation.
- Production PostgreSQL network stays restricted; diagnostics must not expose it.
- Do not run `cat .env`, `printenv`, `ps eww`, `docker inspect` full output or other secret-exfiltrating diagnostics.
- Incident read-only workflow (future): `workflow_dispatch` only, protected environment, time bounds, restricted hosts, redaction, no mutation commands, uploads of sanitized metadata only. Alert receipt must **not** start SSH automatically.

## Stop conditions
Unknown host identity, privilege, tenant ownership, running service, missing backup, customer-data exposure, network/firewall drift, pending release or partial migration: stop and escalate. Unknown database state is not a reason to make changes. Under no circumstances delete production data during diagnosis.

## After explicit repair approval
Create separate change plan/PR; test on staging if feasible; require CI green + manual release approval; record a single controlled action and health readback. Distinguish `observed`, `proposed` and `executed` in reports.
