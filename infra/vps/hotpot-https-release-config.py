#!/usr/bin/python3
"""Set API release HTTPS URL only when a real enabled Nginx site proves it is healthy.

Owner-only GitHub Issue #3 maintenance: never infer a hostname from untrusted inputs,
modify application secrets, disable TLS verification, or deploy by itself.
"""
import glob
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import urllib.parse

CONFIG = Path("/etc/sichuan-hotpot/release.json")
API_HELPER = Path("/usr/local/sbin/hotpot-api-release-manual")
SITES = ("/etc/nginx/sites-enabled/*", "/etc/nginx/conf.d/*.conf")


class ConfigError(Exception):
    pass


def require(condition, reason):
    if not condition:
        raise ConfigError(reason)


def execute(argv, timeout=25):
    p = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=timeout)
    return p.returncode, p.stdout.decode("utf-8", errors="replace")


def find_sites():
    """Derive a single verified HTTPS virtual host reverse-proxying the existing API."""
    names = set()
    for pattern in SITES:
        for name in sorted(glob.glob(pattern)):
            path = Path(name)
            if not path.is_file():
                continue
            try:
                source = path.read_text(encoding="utf-8")
            except (OSError, UnicodeError):
                continue
            # Split across virtual hosts, preserving nested location blocks.
            for block in re.split(r"\bserver\s*\{", source)[1:]:
                if not re.search(r"\blisten\s+(?:[0-9.]+:)?443\s+[^;]*\bssl\b", block):
                    continue
                if not re.search(r"\bproxy_pass\s+http://127\.0\.0\.1:3000\s*;", block):
                    continue
                m = re.search(r"^\s*server_name\s+([^;]+);", block, re.MULTILINE)
                if not m:
                    continue
                values = m.group(1).split()
                require(len(values) == 1, "ambiguous_server_name")
                name = values[0].lower().rstrip(".")
                require(re.fullmatch(r"(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}", name) is not None
                        and name != "api.example.com", "untrusted_server_name")
                names.add(name)
    require(len(names) == 1, "https_api_nginx_site_not_unique")
    return next(iter(names))


def atomic_file(destination, contents, mode):
    fd, temp = tempfile.mkstemp(prefix=".hotpot-https-", dir=destination.parent)
    os.fchmod(fd, mode)
    os.fchown(fd, 0, 0)
    try:
        with os.fdopen(fd, "wb") as writer:
            writer.write(contents)
            writer.flush()
            os.fsync(writer.fileno())
        os.replace(temp, destination)
    finally:
        Path(temp).unlink(missing_ok=True)


def main():
    require(os.geteuid() == 0, "requires_root")
    os.umask(0o077)
    state = CONFIG.lstat()
    require(stat.S_ISREG(state.st_mode) and state.st_uid == 0
            and (state.st_mode & 0o027) == 0, "unsafe_release_config_permissions")
    old = CONFIG.read_bytes()
    try:
        cfg = json.loads(old)
    except (ValueError, UnicodeError):
        raise ConfigError("invalid_release_config")
    require(isinstance(cfg, dict) and set(cfg) == {"https_base_url"}
            and isinstance(cfg["https_base_url"], str), "unreviewed_release_config")
    require(execute(["/usr/sbin/nginx", "-t"])[0] == 0, "nginx_config_invalid")
    host = find_sites()
    url = "https://" + host
    require(cfg["https_base_url"] in ("", url), "configured_https_domain_differs")
    # Do not use -k/--insecure or bypass DNS/CA validation.
    for prefix in ("http://127.0.0.1:3000", url):
        for endpoint in ("/health/live", "/health/ready"):
            require(execute(["/usr/bin/curl", "--fail", "--silent",
                             "--connect-timeout", "3", "--max-time", "10",
                             "--output", "/dev/null", prefix + endpoint], 16)[0] == 0,
                    "api_health_or_https_certificate_not_ready")
    if cfg["https_base_url"] == url:
        print("https_release_config=ALREADY_CORRECT", flush=True)
        return
    new = json.dumps({"https_base_url": url}, separators=(",", ":")).encode() + b"\n"
    atomic_file(CONFIG, new, stat.S_IMODE(state.st_mode))
    try:
        result, output = execute([str(API_HELPER), "--check-config"], 40)
        require(result == 0
                and "https_configured=PASS" in output.splitlines()
                and "migration_ready=PASS" in output.splitlines()
                and "backend_environment=PASS" in output.splitlines(),
                "api_config_gate_still_blocked")
    except Exception:
        atomic_file(CONFIG, old, stat.S_IMODE(state.st_mode))
        raise
    print("https_release_config=PASS;certificate=PASS;api_health=PASS", flush=True)


if __name__ == "__main__":
    try:
        main()
    except ConfigError as exc:
        print("https_release_config=BLOCKED;reason=" + str(exc), file=sys.stderr)
        sys.exit(2)
    except Exception:
        print("https_release_config=BLOCKED;reason=unexpected_error", file=sys.stderr)
        sys.exit(2)
