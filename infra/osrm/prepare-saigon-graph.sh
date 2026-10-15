#!/usr/bin/env bash
# Run only after owner authorizes an OSRM rollout and VPS capacity gate PASS.
# Never preprocess country maps on the live API/Postgres host.
set -euo pipefail
if [[ "${1:-}" != "--approved-city-preprocess" ]]; then
  echo "BLOCKED: operator approval flag required" >&2
  exit 2
fi
command -v docker >/dev/null || { echo "BLOCKED: docker missing" >&2; exit 2; }
command -v curl >/dev/null || { echo "BLOCKED: curl missing" >&2; exit 2; }
DATA_DIR="/opt/sichuan-hotpot/osrm"
test -d "$DATA_DIR" && test -w "$DATA_DIR" || { echo "BLOCKED: approved OSRM data dir unavailable" >&2; exit 2; }
test ! -e "$DATA_DIR/Saigon.osrm.hsgr" || { echo "BLOCKED: existing graph present; refuse overwrite" >&2; exit 2; }
FREE_DISK_KIB="$(df -Pk "$DATA_DIR" | awk 'END{print $4}')"
MEM_AVAILABLE_KIB="$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)"
# Guard headroom for NestJS API/Postgres. A low-memory host should build the graph
# off-host and copy preprocessed files rather than using this script.
if (( FREE_DISK_KIB < 3 * 1024 * 1024 || MEM_AVAILABLE_KIB < 2 * 1024 * 1024 )); then
  echo "BLOCKED: insufficient safe OSRM preprocessing headroom" >&2
  exit 2
fi
PBF="$DATA_DIR/Saigon.osm.pbf"
if [[ ! -f "$PBF" ]]; then
  curl --proto '=https' --tlsv1.2 --fail --location --retry 2     --connect-timeout 15 --max-time 120 --max-filesize 104857600     --output "$PBF.partial"     'https://download.bbbike.org/osm/bbbike/Saigon/Saigon.osm.pbf'
  bytes="$(stat -c %s "$PBF.partial")"
  if (( bytes < 1000000 || bytes > 104857600 )); then
    echo "BLOCKED: invalid city extract size" >&2
    rm -f "$PBF.partial"
    exit 2
  fi
  mv "$PBF.partial" "$PBF"
fi
# Car profile only. City-size OSRM graph is static and uses CH consistently on
# ARM64 and x86_64. Low priority and hard RAM/CPU caps protect current API/DB.
image='ghcr.io/project-osrm/osrm-backend:v5.27.1'
common=(--rm --cpus=0.75 --memory=1400m --memory-swap=1400m --pids-limit=256   --network=none --security-opt=no-new-privileges --cap-drop=ALL -v "$DATA_DIR:/data")
docker run "${common[@]}" "$image" osrm-extract -p /opt/car.lua /data/Saigon.osm.pbf
docker run "${common[@]}" "$image" osrm-contract /data/Saigon.osrm
test -s "$DATA_DIR/Saigon.osrm.hsgr" || { echo "BLOCKED: CH graph missing" >&2; exit 2; }
printf 'OSRM graph built for bounded Saigon extract; deployment NOT started\n'
