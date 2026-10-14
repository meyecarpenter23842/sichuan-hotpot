#!/usr/bin/python3
"""Install the verified Resend sender in the protected VPS API environment.

The API key arrives only on stdin over pinned SSH. Never print secrets, read
production tables, change application code, or run Prisma migrations.
A failed restart/health check atomically restores the previous environment.
"""
import json
import os
from pathlib import Path
import re
import secrets
import stat
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlsplit

API_ENV = Path("/etc/sichuan-hotpot/api.env")
RELEASE_SETTINGS = Path("/etc/sichuan-hotpot/release.json")
SERVICE = "hotpot-api.service"
SENDER = "noreply@bepsi.click"
KEY_NAME = "RESEND_API_KEY"
SENDER_NAME = "HOTPOT_MAIL_FROM"


class Blocked(Exception):
    pass


def require(condition, reason):
    if not condition:
        raise Blocked(reason)


def validated_key(value):
    require(bool(re.fullmatch(r"re_[A-Za-z0-9_-]{20,150}", value)), "invalid_resend_key")
    return value


def rewrite_content(original, key):
    """Preserve all unrelated env bytes and newline conventions."""
    validated_key(key)
    require(b"\x00" not in original and len(original) <= 65536, "invalid_environment")
    text = original.decode("utf-8")
    lines = text.splitlines(keepends=True)
    require(all("\n" not in row.rstrip("\r\n") for row in lines), "invalid_environment")
    ending = "\r\n" if "\r\n" in text else "\n"
    new = {KEY_NAME: key, SENDER_NAME: SENDER}
    for name, value in new.items():
        indexes = [i for i, row in enumerate(lines) if row.startswith(name + "=")]
        require(len(indexes) <= 1, "duplicate_environment_key")
        if indexes:
            index = indexes[0]
            old_ending = "\r\n" if lines[index].endswith("\r\n") else (
                "\n" if lines[index].endswith("\n") else "")
            lines[index] = name + "=" + value + old_ending
        else:
            if lines and not lines[-1].endswith(("\r", "\n")):
                lines[-1] += ending
            lines.append(name + "=" + value + ending)
    updated = "".join(lines).encode("utf-8")
    require(len(updated) <= 65536, "environment_too_large")
    return updated, updated != original


def checked_env():
    st = API_ENV.lstat()
    require(stat.S_ISREG(st.st_mode) and st.st_uid == 0 and
            st.st_mode & 0o022 == 0, "unsafe_api_environment")
    return st, API_ENV.read_bytes()


def trusted_api_origin():
    st = RELEASE_SETTINGS.lstat()
    require(stat.S_ISREG(st.st_mode) and st.st_uid == 0 and
            st.st_mode & 0o022 == 0 and st.st_size <= 8192, "unsafe_release_config")
    data = json.loads(RELEASE_SETTINGS.read_text())
    require(set(data) == {"https_base_url"}, "unexpected_release_config")
    origin = data["https_base_url"].rstrip("/")
    parsed = urlsplit(origin)
    require(parsed.scheme == "https" and parsed.netloc and
            not parsed.username and not parsed.password and
            not parsed.path and not parsed.query and not parsed.fragment,
            "invalid_api_origin")
    return origin


def run(command, timeout=20):
    result = subprocess.run(command, stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, timeout=timeout, check=False)
    return result.returncode, result.stdout


def live_and_ready(origin):
    for base in ("http://127.0.0.1:3000", origin):
        for endpoint in ("/health/live", "/health/ready"):
            status, _ = run(["/usr/bin/curl", "--fail", "--silent",
                             "--connect-timeout", "3", "--max-time", "6",
                             "--output", "/dev/null", base + endpoint], timeout=9)
            if status != 0:
                return False
    return True


def atomic_replace(target, content, st):
    fd, name = tempfile.mkstemp(prefix=".resend-config-", dir=str(target.parent))
    try:
        with os.fdopen(fd, "wb") as output:
            os.fchmod(output.fileno(), stat.S_IMODE(st.st_mode))
            os.fchown(output.fileno(), st.st_uid, st.st_gid)
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.replace(name, target)
        dirfd = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(dirfd)
        finally:
            os.close(dirfd)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def apply(key):
    require(os.geteuid() == 0, "root_required")
    os.umask(0o077)
    st, previous = checked_env()
    updated, changed = rewrite_content(previous, key)
    origin = trusted_api_origin()
    code, output = run(["/usr/bin/systemctl", "is-active", SERVICE], timeout=10)
    require(code == 0 and output.strip() == b"active", "api_service_inactive")
    code, env_files = run(["/usr/bin/systemctl", "show", SERVICE,
                           "--property=EnvironmentFiles"], timeout=10)
    require(code == 0 and b"/etc/sichuan-hotpot/api.env" in env_files,
            "api_environment_not_attached")
    require(live_and_ready(origin), "api_unhealthy_before_change")
    if not changed:
        print("resend_config=ALREADY_READY;api_live=PASS;api_ready=PASS", flush=True)
        return

    # Temporary root-only rollback backup, removed after verification or rollback.
    backup = API_ENV.with_name("api.env.resend-rollback-" + secrets.token_hex(8))
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
    fd = os.open(backup, flags, 0o600)
    verified_or_restored = False
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(previous)
            output.flush()
            os.fsync(output.fileno())
        try:
            atomic_replace(API_ENV, updated, st)
            code, _ = run(["/usr/bin/systemctl", "restart", SERVICE], timeout=50)
            require(code == 0, "api_restart_failed")
            for _ in range(12):
                if live_and_ready(origin):
                    verified_or_restored = True
                    print("resend_config=PASS;api_live=PASS;api_ready=PASS", flush=True)
                    return
                time.sleep(2)
            raise Blocked("api_unhealthy_after_change")
        except Exception:
            atomic_replace(API_ENV, previous, st)
            run(["/usr/bin/systemctl", "restart", SERVICE], timeout=50)
            require(live_and_ready(origin), "rollback_health_failed")
            verified_or_restored = True
            raise Blocked("resend_update_rolled_back")
    finally:
        # Keep the root-only rollback copy if restoration itself fails.
        if verified_or_restored:
            backup.unlink(missing_ok=True)


if __name__ == "__main__":
    try:
        # First stdin line (base64 source) has already been consumed by the
        # SSH bootstrap. The second line is the secret; never expose it.
        raw = sys.stdin.buffer.readline(256).rstrip(b"\r\n")
        require(len(raw) > 0 and len(raw) < 255, "missing_resend_key")
        apply(validated_key(raw.decode("ascii")))
    except Blocked as error:
        print("resend_config=BLOCKED;reason=" + str(error), file=sys.stderr)
        sys.exit(2)
    except Exception:
        print("resend_config=BLOCKED;reason=operation_failed", file=sys.stderr)
        sys.exit(2)
