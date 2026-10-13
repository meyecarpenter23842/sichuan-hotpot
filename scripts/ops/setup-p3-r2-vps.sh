#!/usr/bin/env bash
# One-time interactive setup on the VPS (not on GitHub Actions).
set -euo pipefail
umask 077
[[ "$EUID" -eq 0 && -t 0 ]] || { echo "Run via sudo from an interactive VPS SSH terminal."; exit 1; }
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends age rclone
install -d -m 0700 -o root -g root /etc/sichuan-hotpot
install -d -m 0700 -o root -g root /var/lib/sichuan-hotpot/p3-backups
key=/etc/sichuan-hotpot/p3-recovery.key
cfg=/etc/sichuan-hotpot/p3-rclone.conf
settings=/etc/sichuan-hotpot/p3-backup.json
if [[ ! -e "$key" ]]; then
  age-keygen -o "$key" >/dev/null 2>&1
  chmod 600 "$key"
fi
[[ -f "$key" && ! -L "$key" ]] || exit 1
recipient="$(age-keygen -y "$key")"
[[ "$recipient" =~ ^age1[0-9a-z]{58}$ ]] || exit 1
if [[ ! -e "$cfg" ]]; then
  read -rp "R2 access key ID (scoped only to hotpot-db-backups-private): " access
  read -rsp "R2 secret access key: " secret
  printf '\n'
  [[ "$access" =~ ^[A-Za-z0-9]{16,128}$ ]] || { echo "Invalid access key."; exit 1; }
  [[ "$secret" =~ ^[A-Za-z0-9+/=_-]{24,256}$ ]] || { echo "Invalid secret key."; exit 1; }
  printf '[hotpot-r2]\ntype = s3\nprovider = Cloudflare\naccess_key_id = %s\nsecret_access_key = %s\nendpoint = https://bae4e0be81d8f56be5b75402ccd3bb9b.r2.cloudflarestorage.com\nno_check_bucket = true\n' "$access" "$secret" > "$cfg"
  unset secret access
  chmod 600 "$cfg"
fi
RCLONE_CONFIG="$cfg" rclone lsf hotpot-r2:hotpot-db-backups-private --max-depth 1 >/dev/null
echo "Private Cloudflare R2 access: PASS"
if [[ ! -e "$settings" ]]; then
  printf '\nIMPORTANT: Save the private recovery identity independently OFF the VPS.\n'
  printf 'In your private VPS terminal, inspect using this command:\n'
  printf '  sudo cat /etc/sichuan-hotpot/p3-recovery.key\n'
  printf 'Keep that identity in a secure password manager/offline safe, NEVER in ChatGPT/GitHub/logs.\n'
  read -rp 'ONLY AFTER YOU HAVE ACTUALLY SAVED AN OFF-VPS COPY, type SAVED_OFFSITE: ' reply
  [[ "$reply" == SAVED_OFFSITE ]] || { echo "Offsite recovery not confirmed. Setup remains locked."; exit 1; }
  printf '{"bucket":"hotpot-db-backups-private","remote":"hotpot-r2","recipient":"%s","offline_recovery_confirmed":true}\n' "$recipient" > "$settings"
  chmod 600 "$settings"
fi
echo "P3 encrypted private R2 backup is configured; no migration has run."
