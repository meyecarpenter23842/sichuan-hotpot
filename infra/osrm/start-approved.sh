#!/usr/bin/env bash
# Manual owner-authorized release ONLY. Never run from PR CI or push events.
set -euo pipefail
if [[ "${1:-}" != "--approved-start" ]]; then
  echo "BLOCKED: explicit approval required" >&2
  exit 2
fi
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$here/preflight.sh"
# Must be an isolated loopback listener and not restart API or PostgreSQL.
docker compose -f "$here/compose.yml" up -d --no-build
healthy=0
for attempt in {1..15}; do
  if curl --fail --silent --show-error --max-time 2     'http://127.0.0.1:5000/route/v1/driving/106.6900000,10.7720000;106.6950000,10.7750000?overview=false'     | grep -Fq '"code":"Ok"'; then
    healthy=1
    break
  fi
  sleep 2
done
if (( healthy == 0 )); then
  docker compose -f "$here/compose.yml" down
  echo "BLOCKED: OSRM failed sample route; sidecar rolled back. API/DB untouched."
  exit 1
fi
systemctl is-active --quiet hotpot-api.service
systemctl is-active --quiet postgresql.service
echo "OSRM_LOCAL_ROUTE=PASS; API=ACTIVE; POSTGRESQL=ACTIVE"
