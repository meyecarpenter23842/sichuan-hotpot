#!/usr/bin/python3
"""Owner-only FCM Apps Script relay config; no keys or tokens printed."""
import base64
import hashlib
import hmac
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
import urllib.request
import urllib.error
import socket

ENV = Path("/etc/sichuan-hotpot/api.env")
SERVICE = "hotpot-api.service"
URL_RE = re.compile(r"^https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec$")
SECRET_RE = re.compile(r"^[a-fA-F0-9]{64}$")


class Blocked(Exception):
    pass


def settings(raw):
    try:
        data = json.loads(raw)
    except (TypeError, ValueError) as exc:
        raise Blocked("invalid_json") from exc
    if not isinstance(data, dict) or set(data) != {"url", "secret"}:
        raise Blocked("invalid_payload")
    url, secret = data["url"], data["secret"]
    if not isinstance(url, str) or not URL_RE.fullmatch(url):
        raise Blocked("invalid_relay_url")
    if not isinstance(secret, str) or not SECRET_RE.fullmatch(secret):
        raise Blocked("invalid_relay_secret")
    return {"FCM_RELAY_URL": url, "FCM_RELAY_SECRET_HEX": secret.lower()}


def read_env(text):
    env = {}
    for line in text.splitlines():
        if not line or line.startswith("#"):
            continue
        name, sep, value = line.partition("=")
        if not sep or not re.fullmatch(r"[A-Z][A-Z0-9_]*", name) or name in env:
            raise Blocked("invalid_existing_environment")
        env[name] = value
    return env


def render(text, updates):
    current = read_env(text)
    output = []
    for line in text.splitlines():
        name = line.partition("=")[0]
        output.append(name + "=" + updates[name] if name in updates else line)
    for name, value in updates.items():
        if name not in current:
            output.append(name + "=" + value)
    return "\n".join(output) + "\n"


def proof(url, secret):
    data = {"ts": int(time.time() * 1000), "nonce": str(__import__("uuid").uuid4()), "mode": "PROBE"}
    encoded = base64.urlsafe_b64encode(json.dumps(data, separators=(",", ":")).encode()).decode().rstrip("=")
    signature = base64.urlsafe_b64encode(
        hmac.new(bytes.fromhex(secret), encoded.encode(), hashlib.sha256).digest()
    ).decode().rstrip("=")
    payload = json.dumps({"payload": encoded, "signature": signature}).encode()
    request = urllib.request.Request(
        url, data=payload, method="POST", headers={"Content-Type": "application/json"}
    )
    # Distinguish public deployment permissions, slow Google endpoints, and
    # non-JSON sign-in/redirect pages without printing the private /exec URL.
    try:
        with urllib.request.urlopen(request, timeout=35) as response:
            body = response.read(4097)
            if len(body) > 4096:
                raise Blocked("relay_response_too_large")
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            raise Blocked("relay_http_forbidden_check_anyone_access") from exc
        if exc.code in (404, 405):
            raise Blocked("relay_http_not_found_check_deployment") from exc
        if exc.code == 429:
            raise Blocked("relay_http_rate_limited") from exc
        raise Blocked("relay_http_provider_error") from exc
    except (socket.timeout, TimeoutError) as exc:
        raise Blocked("relay_probe_timeout") from exc
    except urllib.error.URLError as exc:
        reason = getattr(exc, "reason", None)
        if isinstance(reason, (socket.timeout, TimeoutError)):
            raise Blocked("relay_probe_timeout") from exc
        raise Blocked("relay_dns_tls_or_network_unavailable") from exc
    except (OSError, ValueError) as exc:
        raise Blocked("relay_network_unavailable") from exc
    try:
        result = json.loads(body)
    except (ValueError, UnicodeError) as exc:
        raise Blocked("relay_non_json_check_public_access") from exc
    if result != {"ok": True}:
        if isinstance(result, dict):
            code = result.get("code")
            if code == "INVALID_SIGNATURE":
                raise Blocked("relay_signature_mismatch")
            if code == "NOT_CONFIGURED":
                raise Blocked("relay_script_secret_missing")
            if code == "FCM_REJECTED":
                raise Blocked("relay_firebase_permission_failed")
            if code == "GATEWAY_ERROR":
                raise Blocked("relay_script_execution_error")
            if code == "INVALID_PAYLOAD":
                raise Blocked("relay_payload_mismatch")
            if code == "REPLAYED":
                raise Blocked("relay_duplicate_probe")
        raise Blocked("relay_probe_rejected")


def atomic_write(text, owner):
    fd, tmp = tempfile.mkstemp(prefix=".fcm-relay-", dir=ENV.parent)
    try:
        os.fchmod(fd, stat.S_IMODE(owner.st_mode))
        os.fchown(fd, owner.st_uid, owner.st_gid)
        with os.fdopen(fd, "w") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, ENV)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def restart_ready():
    try:
        subprocess.run(["/usr/bin/systemctl", "restart", SERVICE], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
        for _ in range(12):
            try:
                for path in ("/health/live", "/health/ready"):
                    with urllib.request.urlopen("http://127.0.0.1:3000" + path, timeout=4) as res:
                        if res.status != 200:
                            raise ValueError("not_ready")
                return True
            except Exception:
                time.sleep(2)
    except Exception:
        pass
    return False


def runtime_loaded(updates):
    try:
        pid = int(subprocess.run(["/usr/bin/systemctl", "show", "-p", "MainPID", "--value", SERVICE],
                                 check=True, capture_output=True, text=True, timeout=4).stdout.strip())
        if pid <= 0:
            return False
        env = {}
        for line in Path("/proc").joinpath(str(pid), "environ").read_bytes().split(b"\0"):
            key, sep, val = line.partition(b"=")
            if sep and key.decode(errors="ignore") in updates:
                env[key.decode()] = val.decode()
        return all(env.get(key) == value for key, value in updates.items())
    except Exception:
        return False


def configure(raw):
    if os.geteuid() != 0:
        raise Blocked("root_required")
    updates = settings(raw)
    metadata = os.lstat(ENV)
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_mode & 0o137:
        raise Blocked("unsafe_environment")
    original = ENV.read_text()
    existing = read_env(original)
    if existing.get("HOST") != "127.0.0.1" or existing.get("PORT") != "3000":
        raise Blocked("unsafe_api_bind")
    proof(updates["FCM_RELAY_URL"], updates["FCM_RELAY_SECRET_HEX"])
    updated = render(original, updates)
    if updated == original:
        if not restart_ready() or not runtime_loaded(updates):
            raise Blocked("runtime_not_ready")
        return "ALREADY_READY"
    atomic_write(updated, metadata)
    if restart_ready() and runtime_loaded(updates):
        return "APPLIED"
    atomic_write(original, metadata)
    if not restart_ready():
        raise Blocked("rollback_failed")
    raise Blocked("rolled_back_after_failed_health")


if __name__ == "__main__":
    try:
        result = configure(sys.stdin.read(8193))
        print("relay=" + result + ";probe=PASS;api=PASS")
    except Blocked as exc:
        print("relay=BLOCKED;reason=" + str(exc))
        sys.exit(1)
    except Exception:
        print("relay=BLOCKED;reason=unexpected_failure")
        sys.exit(1)
