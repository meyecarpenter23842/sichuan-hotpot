#!/usr/bin/python3
"""Owner-only live API CORS adjustment for the independent Admin PWA.

Changes only the existing CORS_ALLOWED_ORIGINS line in a root-controlled env
file; validates configured HTTPS, loopback, and Admin OPTIONS preflights.
On verification failure the original env bytes are restored and API restarted.
No secret values or environment contents are printed.
"""
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlsplit
import json

API_ENV = Path("/etc/sichuan-hotpot/api.env")
RELEASE_SETTINGS = Path("/etc/sichuan-hotpot/release.json")
SERVICE = "hotpot-api.service"
ADMIN = "https://sichuan-hotpot-admin.vercel.app"
ADMIN_CUSTOM = "https://admin.bepsi.click"
ADMIN_ORIGINS = (ADMIN, ADMIN_CUSTOM)
CUSTOMER = "https://sichuan-hotpot-customer.vercel.app"


class Blocked(Exception):
    pass


def require(condition, error):
    if not condition:
        raise Blocked(error)


def rewrite_content(data):
    """Pure function: preserve unrelated env entries exactly, including secrets."""
    require(b"\0" not in data, "invalid_environment")
    text = data.decode("utf-8")
    parts = text.splitlines(keepends=True)
    indexes = [i for i, entry in enumerate(parts)
               if entry.startswith("CORS_ALLOWED_ORIGINS=")]
    require(len(indexes) == 1, "cors_configuration_missing_or_duplicate")
    index = indexes[0]
    line = parts[index]
    ending = "\r\n" if line.endswith("\r\n") else "\n" if line.endswith("\n") else ""
    value = line[len("CORS_ALLOWED_ORIGINS="):].removesuffix(ending)
    origins = [item.strip() for item in value.split(",")]
    require(CUSTOMER in origins and "" not in origins, "customer_origin_not_configured")
    for origin in origins:
        parsed = urlsplit(origin)
        require(parsed.scheme == "https" and parsed.hostname and parsed.netloc
                and parsed.path == "" and not parsed.query and not parsed.fragment
                and not parsed.username and not parsed.password and origin == parsed.geturl(),
                "unsafe_cors_origin")
    missing = [origin for origin in ADMIN_ORIGINS if origin not in origins]
    if not missing:
        return data, False
    origins.extend(missing)
    parts[index] = "CORS_ALLOWED_ORIGINS=" + ",".join(origins) + ending
    return "".join(parts).encode("utf-8"), True


def trusted_origin():
    raw = RELEASE_SETTINGS.read_bytes()
    require(len(raw) < 8192 and not RELEASE_SETTINGS.is_symlink(),
            "unsafe_release_settings")
    cfg = json.loads(raw)
    require(set(cfg) == {"https_base_url"}, "unexpected_release_settings")
    origin = cfg["https_base_url"].rstrip("/")
    parsed = urlsplit(origin)
    require(parsed.scheme == "https" and parsed.hostname and
            not parsed.username and not parsed.password and not parsed.query
            and not parsed.fragment and not parsed.path,
            "api_https_not_configured")
    return origin


def run(command, timeout=25):
    outcome = subprocess.run(command, capture_output=True, timeout=timeout)
    return outcome.returncode, outcome.stdout


def good_http(url):
    code, _ = run(["/usr/bin/curl", "--fail", "--silent", "--show-error",
                   "--connect-timeout", "3", "--max-time", "6",
                   "--output", "/dev/null", url], timeout=10)
    return code == 0


def good_preflight(base, method, resource, requested_headers, admin_origin=ADMIN):
    code, headers = run(["/usr/bin/curl", "--fail", "--silent", "--show-error",
                         "--connect-timeout", "3", "--max-time", "6",
                         "-X", "OPTIONS", "-D", "-", "-o", "/dev/null",
                         "-H", "Origin: " + admin_origin,
                         "-H", "Access-Control-Request-Method: " + method,
                         "-H", "Access-Control-Request-Headers: " + requested_headers,
                         base + resource], timeout=10)
    if code:
        return False
    fields = {}
    for row in headers.decode("utf-8", "replace").splitlines():
        if ":" in row:
            k, v = row.split(":", 1)
            fields[k.strip().lower()] = v.strip()
    methods = [item.strip() for item in fields.get("access-control-allow-methods", "").split(",")]
    return fields.get("access-control-allow-origin") == admin_origin and method in methods


def healthy_https_and_cors(origin):
    for base in ("http://127.0.0.1:3000", origin):
        for path in ("/health/live", "/health/ready"):
            if not good_http(base + path):
                return False
        for admin_origin in ADMIN_ORIGINS:
            if not good_preflight(base, "POST", "/auth/login",
                                  "content-type", admin_origin):
                return False
            for method in ("PATCH", "PUT"):
                if not good_preflight(base, method,
                                      "/admin/branches/00000000-0000-4000-8000-000000000000/catalog",
                                      "authorization,content-type", admin_origin):
                    return False
    return True


def atomic_replace(target, data, st):
    fd, name = tempfile.mkstemp(prefix=".api-cors-", dir=str(target.parent))
    try:
        with os.fdopen(fd, "wb") as out:
            os.fchmod(out.fileno(), st.st_mode & 0o777)
            os.fchown(out.fileno(), st.st_uid, st.st_gid)
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
        os.replace(name, target)
        dfd = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(dfd)
        finally:
            os.close(dfd)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def main():
    require(os.geteuid() == 0, "root_required")
    os.umask(0o077)
    st = API_ENV.lstat()
    require(API_ENV.is_file() and not API_ENV.is_symlink()
            and st.st_uid == 0 and st.st_mode & 0o022 == 0,
            "api_environment_not_protected")
    before = API_ENV.read_bytes()
    updated, changed = rewrite_content(before)
    origin = trusted_origin()
    require(good_http(origin + "/health/ready") and
            good_http("http://127.0.0.1:3000/health/ready"),
            "backend_not_ready_before_change")
    code, output = run(["/usr/bin/systemctl", "is-active", SERVICE], timeout=10)
    require(code == 0 and output.strip() == b"active", "api_service_inactive")
    if not changed and healthy_https_and_cors(origin):
        print("admin_cors=ALREADY_READY;api_live=PASS;api_ready=PASS", flush=True)
        return
    # Preserve root-only pre-change bytes; never log content or allow a symlink.
    backup = API_ENV.with_name("api.env.admin-cors-backup-" + secrets.token_hex(8))
    fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as out:
        out.write(before)
        out.flush()
        os.fsync(out.fileno())
    try:
        if changed:
            atomic_replace(API_ENV, updated, st)
        code, _ = run(["/usr/bin/systemctl", "restart", SERVICE], timeout=45)
        require(code == 0, "api_restart_failed")
        for _ in range(15):
            if healthy_https_and_cors(origin):
                print("admin_cors=PASS;api_live=PASS;api_ready=PASS", flush=True)
                return
            time.sleep(2)
        raise Blocked("admin_cors_preflight_failed")
    except Exception:
        atomic_replace(API_ENV, before, st)
        run(["/usr/bin/systemctl", "restart", SERVICE], timeout=45)
        require(good_http(origin + "/health/ready")
                and good_http("http://127.0.0.1:3000/health/ready"),
                "rollback_health_failed")
        raise Blocked("cors_update_rolled_back")


if __name__ == "__main__":
    try:
        main()
    except Blocked as exc:
        print("admin_cors=BLOCKED;reason=" + str(exc), file=sys.stderr)
        sys.exit(2)
    except Exception:
        print("admin_cors=BLOCKED;reason=operation_failed", file=sys.stderr)
        sys.exit(2)
