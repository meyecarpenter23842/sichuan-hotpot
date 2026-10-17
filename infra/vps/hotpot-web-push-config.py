#!/usr/bin/python3
"""Configure VAPID Web Push keys on the production API without exposing secrets."""
from __future__ import annotations

import fcntl
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

ENV_PATH = Path("/etc/sichuan-hotpot/api.env")
RELEASE_PATH = Path("/etc/sichuan-hotpot/release.json")
CURRENT_ROOT = Path("/opt/sichuan-hotpot/current")
SERVICE = "hotpot-api.service"
LOCK_PATH = Path("/run/lock/hotpot-web-push-config.lock")
DEFAULT_SUBJECT = "https://bepsi.click"
KEY_RE = re.compile(r"^[A-Za-z0-9_-]+$")


class ConfigError(Exception):
    pass


def require(condition: bool, code: str) -> None:
    if not condition:
        raise ConfigError(code)


def parse_env_text(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in text.splitlines():
        if not raw or raw.startswith("#"):
            continue
        require("=" in raw, "malformed_environment")
        key, value = raw.split("=", 1)
        require(bool(key) and key not in values, "duplicate_environment_variable")
        values[key] = value
    return values


def replace_env_text(text: str, updates: dict[str, str]) -> str:
    remaining = dict(updates)
    output: list[str] = []
    for raw in text.splitlines():
        if raw and not raw.startswith("#") and "=" in raw:
            key, _ = raw.split("=", 1)
            if key in remaining:
                output.append(key + "=" + remaining.pop(key))
                continue
        output.append(raw)
    if output and output[-1] != "":
        output.append("")
    for key in sorted(remaining):
        output.append(key + "=" + remaining[key])
    return "\n".join(output).rstrip("\n") + "\n"


def keypair_valid(public_key: str, private_key: str) -> bool:
    return (
        80 <= len(public_key) <= 128
        and 40 <= len(private_key) <= 96
        and bool(KEY_RE.fullmatch(public_key))
        and bool(KEY_RE.fullmatch(private_key))
    )


def subject_valid(subject: str) -> bool:
    parsed = urllib.parse.urlsplit(subject)
    if parsed.scheme == "mailto":
        return bool(parsed.path and "@" in parsed.path)
    return parsed.scheme == "https" and bool(parsed.hostname) and not parsed.username and not parsed.password


def release_base_url() -> str:
    data = json.loads(RELEASE_PATH.read_text())
    value = str(data.get("https_base_url", "")).rstrip("/")
    parsed = urllib.parse.urlsplit(value)
    require(
        parsed.scheme == "https"
        and parsed.hostname
        and not parsed.username
        and not parsed.password
        and not parsed.query
        and not parsed.fragment
        and parsed.path in ("", "/"),
        "https_not_configured",
    )
    return value


def generate_vapid_keys() -> tuple[str, str]:
    module = CURRENT_ROOT / "node_modules" / "web-push"
    require(module.is_dir() and not module.is_symlink(), "web_push_runtime_missing")
    script = (
        "const webpush=require(process.argv[1]);"
        "const keys=webpush.generateVAPIDKeys();"
        "process.stdout.write(JSON.stringify(keys));"
    )
    result = subprocess.run(
        ["/usr/bin/node", "-e", script, str(module)],
        capture_output=True,
        text=True,
        timeout=15,
        env={"PATH": "/usr/bin:/bin"},
    )
    require(result.returncode == 0, "vapid_generation_failed")
    data = json.loads(result.stdout)
    public_key = str(data.get("publicKey", ""))
    private_key = str(data.get("privateKey", ""))
    require(keypair_valid(public_key, private_key), "vapid_generation_invalid")
    return public_key, private_key


def atomic_write_env(content: str, source_stat: os.stat_result) -> None:
    fd, temporary = tempfile.mkstemp(prefix=".api.env.webpush.", dir=ENV_PATH.parent)
    try:
        os.fchmod(fd, stat.S_IMODE(source_stat.st_mode))
        os.fchown(fd, source_stat.st_uid, source_stat.st_gid)
        with os.fdopen(fd, "w") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, ENV_PATH)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def run_systemctl(action: str) -> None:
    require(action in {"restart"}, "invalid_service_action")
    result = subprocess.run(
        ["/usr/bin/systemctl", action, SERVICE],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=20,
    )
    require(result.returncode == 0, "service_restart_failed")


def curl_text(url: str) -> str:
    result = subprocess.run(
        [
            "/usr/bin/curl", "--fail", "--silent", "--show-error",
            "--connect-timeout", "3", "--max-time", "8", url,
        ],
        capture_output=True,
        text=True,
        timeout=10,
    )
    require(result.returncode == 0, "api_probe_failed")
    return result.stdout


def health_ready(base: str) -> bool:
    try:
        for prefix in ("http://127.0.0.1:3000", base):
            for path in ("/health/live", "/health/ready"):
                curl_text(prefix + path)
        return True
    except ConfigError:
        return False


def push_config_ready(base: str, expected_public_key: str) -> bool:
    try:
        for prefix in ("http://127.0.0.1:3000", base):
            payload = json.loads(curl_text(prefix + "/push/config"))
            if payload.get("enabled") is not True or payload.get("publicKey") != expected_public_key:
                return False
        return True
    except (ConfigError, json.JSONDecodeError):
        return False


def rollback(original: str, source_stat: os.stat_result, base: str) -> None:
    atomic_write_env(original, source_stat)
    try:
        run_systemctl("restart")
    except ConfigError as exc:
        raise ConfigError("rollback_failed") from exc
    require(health_ready(base), "rollback_health_failed")


def configure() -> str:
    require(os.geteuid() == 0, "root_required")
    st = ENV_PATH.stat()
    require(st.st_uid == 0 and st.st_mode & 0o137 == 0, "unsafe_environment_permissions")
    original = ENV_PATH.read_text()
    env = parse_env_text(original)
    base = release_base_url()

    existing_public = env.get("WEB_PUSH_VAPID_PUBLIC_KEY", "").strip()
    existing_private = env.get("WEB_PUSH_VAPID_PRIVATE_KEY", "").strip()
    existing_subject = env.get("WEB_PUSH_VAPID_SUBJECT", "").strip()

    if keypair_valid(existing_public, existing_private):
        public_key, private_key = existing_public, existing_private
    else:
        public_key, private_key = generate_vapid_keys()
    subject = existing_subject if subject_valid(existing_subject) else DEFAULT_SUBJECT

    updates = {
        "WEB_PUSH_VAPID_PUBLIC_KEY": public_key,
        "WEB_PUSH_VAPID_PRIVATE_KEY": private_key,
        "WEB_PUSH_VAPID_SUBJECT": subject,
    }
    updated = replace_env_text(original, updates)
    changed = updated != original

    try:
        if changed:
            atomic_write_env(updated, st)
        run_systemctl("restart")
        for _ in range(10):
            if health_ready(base) and push_config_ready(base, public_key):
                return "PASS" if changed else "ALREADY_READY"
            time.sleep(2)
        raise ConfigError("verification_failed")
    except Exception:
        if changed:
            rollback(original, st, base)
        raise


def main() -> int:
    with LOCK_PATH.open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        result = configure()
        print("web_push=" + result + ";api_live=PASS;api_ready=PASS;public_config=PASS")
        return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ConfigError as error:
        print("web_push=BLOCKED;reason=" + error.args[0])
        sys.exit(1)
    except Exception:
        print("web_push=BLOCKED;reason=operation_failed")
        sys.exit(1)
