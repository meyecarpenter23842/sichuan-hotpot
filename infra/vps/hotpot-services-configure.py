#!/usr/bin/python3
"""One-time production R2 credentials installer (routing uses local OSRM).

Only accepts secrets through SSH stdin under sudo from the owner-only,
environment-protected GitHub Actions workflow. Never logs credentials.
Atomic, root-only env update; probes both providers before any mutation.
Restarts the API with automatic rollback on failure. No DB migrations.
"""
import base64
import datetime as dt
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
import uuid

ENV_FILE = Path("/etc/sichuan-hotpot/api.env")
API_SERVICE = "hotpot-api.service"
KEYS = ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY",
        "R2_BUCKET")
PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/2SAAAAAASUVORK5CYII="
)


def parse_env(lines):
    values = {}
    for line in lines:
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        key, sep, val = line.partition("=")
        if not sep or not re.fullmatch(r"[A-Z][A-Z0-9_]*", key) or key in values:
            raise ValueError("invalid_existing_environment")
        values[key] = val
    return values


def validate(payload):
    if not isinstance(payload, dict) or set(payload) != set(KEYS):
        raise ValueError("invalid_payload")
    if payload["R2_ACCOUNT_ID"] != "bae4e0be81d8f56be5b75402ccd3bb9b":
        raise ValueError("incorrect_r2_account")
    if payload["R2_BUCKET"] != "hot-pot":
        raise ValueError("incorrect_r2_bucket")
    for key in KEYS:
        value = payload[key]
        if not isinstance(value, str) or not value or len(value) > 256:
            raise ValueError("invalid_secret_field")
        if any(ord(ch) < 33 or ord(ch) > 126 for ch in value):
            raise ValueError("control_in_secret_field")
    if not re.fullmatch(r"[A-Za-z0-9]{12,128}", payload["R2_ACCESS_KEY_ID"]):
        raise ValueError("invalid_r2_access_id")
    if len(payload["R2_SECRET_ACCESS_KEY"]) < 20:
        raise ValueError("invalid_r2_secret")
    return payload


def render_env(existing_lines, settings):
    current = parse_env(existing_lines)
    next_lines = []
    for line in existing_lines:
        k = line.partition("=")[0]
        if k in settings:
            next_lines.append(k + "=" + settings[k])
        else:
            next_lines.append(line)
    for k in KEYS:
        if k not in current:
            next_lines.append(k + "=" + settings[k])
    return "\n".join(next_lines) + "\n"


def presign(settings, method, key, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    account = settings["R2_ACCOUNT_ID"]
    host = account + ".r2.cloudflarestorage.com"
    path = "/" + settings["R2_BUCKET"] + "/" + "/".join(
        urllib.parse.quote(s, safe="-_.~") for s in key.split("/")
    )
    date = now.strftime("%Y%m%dT%H%M%SZ")
    short_date = date[:8]
    scope = short_date + "/auto/s3/aws4_request"
    params = {
        "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
        "X-Amz-Credential": settings["R2_ACCESS_KEY_ID"] + "/" + scope,
        "X-Amz-Date": date,
        "X-Amz-Expires": "120",
        "X-Amz-SignedHeaders": "host",
    }
    query = "&".join(urllib.parse.quote(k, safe="-_.~") + "=" +
                     urllib.parse.quote(v, safe="-_.~")
                     for k, v in sorted(params.items()))
    canonical = "\n".join([
        method, path, query, "host:" + host + "\n", "host", "UNSIGNED-PAYLOAD"
    ])
    digest = hashlib.sha256(canonical.encode()).hexdigest()
    string_to_sign = "\n".join(["AWS4-HMAC-SHA256", date, scope, digest])
    secret = ("AWS4" + settings["R2_SECRET_ACCESS_KEY"]).encode()
    for value in (short_date, "auto", "s3", "aws4_request"):
        secret = hmac.new(secret, value.encode(), hashlib.sha256).digest()
    signature = hmac.new(secret, string_to_sign.encode(), hashlib.sha256).hexdigest()
    return "https://" + host + path + "?" + query + "&X-Amz-Signature=" + signature


def probe_r2(settings):
    # A disposable object proves the exact access ID/secret/bucket permissions
    # needed for product PUT, HEAD verification and DELETE cleanup.
    key = "products-image/_bootstrap-check/" + str(uuid.uuid4()) + ".png"
    written = False
    try:
        for method, payload in (("PUT", PNG_1PX), ("HEAD", None)):
            request = urllib.request.Request(
                presign(settings, method, key), data=payload, method=method,
                headers={"Content-Type": "image/png"} if method == "PUT" else {},
            )
            with urllib.request.urlopen(request, timeout=12) as response:
                if response.status not in (200, 201, 204):
                    raise ValueError("r2_provider_unavailable")
            if method == "PUT":
                written = True
    finally:
        if written:
            request = urllib.request.Request(presign(settings, "DELETE", key), method="DELETE")
            with urllib.request.urlopen(request, timeout=12) as response:
                if response.status not in (200, 202, 204):
                    raise ValueError("r2_cleanup_unavailable")


def atomic_file(path, data):
    fd, tmp = tempfile.mkstemp(prefix=".api-env-write-", dir=str(path.parent))
    try:
        os.fchmod(fd, 0o600)
        os.fchown(fd, 0, 0)
        with os.fdopen(fd, "wb") as out:
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def api_healthy():
    for path in ("/health/live", "/health/ready"):
        with urllib.request.urlopen("http://127.0.0.1:3000" + path, timeout=3) as response:
            if response.status != 200:
                return False
    return True


def restart_and_wait():
    subprocess.run(["/usr/bin/systemctl", "restart", API_SERVICE],
                   check=True, timeout=35, capture_output=True)
    for _ in range(12):
        try:
            if api_healthy():
                return True
        except Exception:
            pass
        time.sleep(2)
    return False


def configure(settings, env_file=ENV_FILE):
    st = os.lstat(env_file)
    if not stat.S_ISREG(st.st_mode) or st.st_uid != 0 or st.st_mode & 0o137:
        raise ValueError("unsafe_environment_file")
    raw = env_file.read_bytes()
    old_lines = raw.decode("utf8").splitlines()
    current = parse_env(old_lines)
    if current.get("HOST") != "127.0.0.1" or current.get("PORT") != "3000":
        raise ValueError("unexpected_service_bind")
    updated = render_env(old_lines, settings).encode()
    if updated == raw:
        print("configuration=ALREADY_APPLIED")
        return
    backup_fd, backup_tmp = tempfile.mkstemp(prefix=".api-env-backup-", dir=str(env_file.parent))
    try:
        os.fchmod(backup_fd, 0o600)
        os.fchown(backup_fd, 0, 0)
        with os.fdopen(backup_fd, "wb") as out:
            out.write(raw)
            out.flush()
            os.fsync(out.fileno())
        backup_fd = -1
        # Backup stays root-only for later recovery; only the API env is changed.
        atomic_file(env_file, updated)
        try:
            if not restart_and_wait():
                raise ValueError("api_not_ready")
        except Exception:
            atomic_file(env_file, raw)
            try:
                restart_and_wait()
            except Exception:
                pass
            raise ValueError("rolled_back_after_failed_health") from None
        print("configuration=APPLIED")
        print("health_live=PASS")
        print("health_ready=PASS")
    finally:
        if backup_fd >= 0:
            os.close(backup_fd)


def main():
    if os.geteuid() != 0 or len(sys.argv) != 2 or sys.argv[1] != "--apply":
        raise ValueError("unauthorized_execution")
    # Secrets arrive over pinned SSH stdin, not arguments, source, env output or logs.
    settings = validate(json.load(sys.stdin))
    if ENV_FILE.is_symlink():
        raise ValueError("unsafe_environment_file")
    # Provider checks happen BEFORE touching production env or restarting anything.
    probe_r2(settings)
    print("r2_product_upload_probe=PASS")
    configure(settings)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Never dump Python tracebacks, presigned URLs, provider responses or keys.
        print("configuration=BLOCKED")
        raise SystemExit(2)
