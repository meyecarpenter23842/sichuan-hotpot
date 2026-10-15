#!/usr/bin/env bash
# Read-only, mandatory resource gate before any approved city-sized OSRM rollout.
set -euo pipefail
command -v systemctl >/dev/null || { echo "BLOCKED: systemd missing"; exit 2; }
command -v docker >/dev/null || { echo "BLOCKED: Docker not provisioned"; exit 2; }
mem_total_kib="$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)"
mem_available_kib="$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)"
disk_dir="/opt/sichuan-hotpot"
disk_free_kib="$(df -Pk "$disk_dir" | awk 'END{print $4}')"
# Hard-block even a compact OSRM dataset if memory pressure could displace
# PostgreSQL or NestJS. Capacity is a release requirement, not a suggestion.
if (( mem_total_kib < 3 * 1024 * 1024
      || mem_available_kib < 2 * 1024 * 1024
      || disk_free_kib < 3 * 1024 * 1024 )); then
  echo "BLOCKED: insufficient VPS RAM/disk headroom; do NOT start OSRM beside API/PostgreSQL."
  exit 2
fi
systemctl is-active --quiet hotpot-api.service || { echo "BLOCKED: API not healthy"; exit 2; }
systemctl is-active --quiet postgresql.service || { echo "BLOCKED: PostgreSQL not active"; exit 2; }
if (echo > /dev/tcp/127.0.0.1/5000) 2>/dev/null; then
  echo "BLOCKED: reserved 127.0.0.1:5000 already in use"
  exit 2
fi
test -s "$disk_dir/osrm/Saigon.osrm.hsgr" || { echo "BLOCKED: verified OSRM graph missing"; exit 2; }
echo "OSRM_CAPACITY=PASS (no changes made)"
