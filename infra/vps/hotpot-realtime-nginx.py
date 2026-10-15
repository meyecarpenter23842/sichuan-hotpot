#!/usr/bin/python3
"""Safely enable scoped WebSocket proxying on the existing API HTTPS site.

Only invoked by the owner-controlled release after the new API is healthy.
Never guesses a hostname, changes TLS certificates or exposes internal ports.
"""
from pathlib import Path
import glob
import json
import os
import re
import socket
import ssl
import stat
import subprocess
import tempfile
import time
from urllib.parse import urlparse

CONFIG = Path("/etc/sichuan-hotpot/release.json")
SITE_GLOBS = ("/etc/nginx/sites-enabled/*", "/etc/nginx/conf.d/*.conf")
WS_LOCATION = """    location /realtime {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 75s;
        proxy_send_timeout 75s;
    }
"""


class RealtimeConfigError(Exception):
    pass


def require(ok, code):
    if not ok:
        raise RealtimeConfigError(code)


def upgraded(content):
    """Return safe modified text; reject ambiguous/unrecognized TLS proxy sites."""
    starts = list(re.finditer(r"\bserver\s*\{", content))
    matches = []
    for index, match in enumerate(starts):
        end = starts[index + 1].start() if index + 1 < len(starts) else len(content)
        block = content[match.end():end]
        if (re.search(r"\blisten\s+(?:[0-9.]+:)?443\s+[^;]*\bssl\b", block)
                and re.search(r"\bproxy_pass\s+http://127\.0\.0\.1:3000\s*;", block)):
            matches.append((match.end(), end, block))
    require(len(matches) == 1, "ambiguous_api_https_proxy")
    start, end, block = matches[0]
    if re.search(r"\blocation\s+/realtime\s*\{", block):
        require("proxy_set_header Upgrade $http_upgrade;" in block
                and 'proxy_set_header Connection "upgrade";' in block,
                "existing_realtime_proxy_unreviewed")
        return content
    paths = list(re.finditer(r"(?m)^\s*location\s+/\s*\{", block))
    require(len(paths) == 1, "api_root_location_ambiguous")
    position = start + paths[0].start()
    return content[:position] + WS_LOCATION + content[position:]


def run_command(*argv):
    result = subprocess.run(argv, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                            timeout=20)
    require(result.returncode == 0, "nginx_validation_or_reload_failed")


def atomic_replace(path, source, mode, uid, gid):
    fd, name = tempfile.mkstemp(prefix=".hotpot-ws-", dir=path.parent)
    try:
        os.fchmod(fd, mode)
        os.fchown(fd, uid, gid)
        with os.fdopen(fd, "wb") as writer:
            writer.write(source)
            writer.flush()
            os.fsync(writer.fileno())
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def check_upgrade(origin, *, host_override=None, port=443, tls=True, stage="public"):
    parsed = urlparse(origin)
    require(parsed.scheme == "https" and parsed.port is None
            and parsed.hostname and parsed.path in ("", "/")
            and not parsed.username and not parsed.password
            and not parsed.query and not parsed.fragment,
            "invalid_configured_api_origin")
    hostname = parsed.hostname
    request = ("GET /realtime HTTP/1.1\r\nHost: " + hostname
               + "\r\nUpgrade: websocket\r\nConnection: Upgrade"
               + "\r\nSec-WebSocket-Version: 13"
               + "\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ=="
               + "\r\n\r\n").encode()
    try:
        with socket.create_connection((host_override or hostname, port), timeout=6) as raw:
            if tls:
                with ssl.create_default_context().wrap_socket(raw, server_hostname=hostname) as secure:
                    secure.settimeout(6)
                    secure.sendall(request)
                    response = secure.recv(2048)
            else:
                raw.settimeout(6)
                raw.sendall(request)
                response = raw.recv(2048)
    except ssl.SSLError as exc:
        raise RealtimeConfigError(stage + "_tls_verification_failed") from exc
    except OSError as exc:
        raise RealtimeConfigError(stage + "_connection_unavailable") from exc
    # Never print remote response bodies or certificates.
    if not response.startswith(b"HTTP/1.1 101 "):
        code = response.split(b" ", 2)[1:2]
        if code == [b"404"]:
            raise RealtimeConfigError(stage + "_route_missing")
        if code == [b"400"]:
            raise RealtimeConfigError(stage + "_handshake_rejected")
        if code == [b"403"]:
            raise RealtimeConfigError(stage + "_handshake_forbidden")
        if code == [b"502"]:
            raise RealtimeConfigError(stage + "_backend_unreachable")
        raise RealtimeConfigError(stage + "_upgrade_unavailable")


def effective_nginx_route(origin):
    # Inspect the effective Nginx include tree, not merely the edited site.
    # This guards against editing a file that is not used by the live config.
    hostname = urlparse(origin).hostname
    result = subprocess.run(["/usr/sbin/nginx", "-T"], capture_output=True,
                            timeout=20)
    require(result.returncode == 0 and len(result.stdout) < 2 * 1024 * 1024,
            "nginx_effective_config_unavailable")
    source = result.stdout.decode("utf8", errors="replace")
    hosts = []
    for m in re.finditer(r"(?m)^\s*server\s*\{", source):
        start, depth, i = m.start(), 1, m.end()
        while i < len(source) and depth:
            if source[i] == "{":
                depth += 1
            elif source[i] == "}":
                depth -= 1
            i += 1
        if depth != 0:
            continue
        block = source[start:i]
        if (re.search(r"(?m)^\s*listen\s+[^;]*\b443\b[^;]*\bssl\b", block)
                and any(hostname in entry.split() for entry in
                        re.findall(r"(?m)^\s*server_name\s+([^;]+);", block))):
            hosts.append(block)
    require(len(hosts) == 1, "nginx_configured_host_ambiguous")
    require(re.search(r"\blocation\s+/realtime\s*\{", hosts[0])
            and re.search(r"\bproxy_pass\s+http://127\.0\.0\.1:3000\s*;", hosts[0]),
            "nginx_realtime_location_not_effective")


def verify_route(origin):
    # Local backend -> effective Nginx config -> local TLS -> public HTTPS.
    # systemctl reload is asynchronous: bounded retries avoid racing old workers.
    check_upgrade(origin, host_override="127.0.0.1", port=3000,
                  tls=False, stage="backend")
    effective_nginx_route(origin)
    for attempt in range(15):
        try:
            check_upgrade(origin, host_override="127.0.0.1", stage="nginx_local")
            check_upgrade(origin, stage="public")
            return
        except RealtimeConfigError as exc:
            retryable = ("nginx_local_route_missing", "nginx_local_backend_unreachable",
                         "public_route_missing", "public_backend_unreachable")
            if str(exc) not in retryable or attempt == 14:
                raise
            time.sleep(1)


def main():
    require(os.geteuid() == 0, "requires_root")
    config = json.loads(CONFIG.read_text())
    require(isinstance(config, dict) and isinstance(config.get("https_base_url"), str),
            "missing_https_release_config")
    origin = config["https_base_url"]
    eligible = []
    seen = set()
    for pattern in SITE_GLOBS:
        for value in sorted(glob.glob(pattern)):
            path = Path(value).resolve()
            if path in seen or not path.is_file() or not str(path).startswith("/etc/nginx/"):
                continue
            seen.add(path)
            content = path.read_text()
            try:
                candidate = upgraded(content)
            except RealtimeConfigError:
                continue
            eligible.append((path, content, candidate))
    require(len(eligible) == 1, "api_https_site_not_unique")
    path, original, updated = eligible[0]
    mode = path.stat()
    require(stat.S_ISREG(mode.st_mode) and mode.st_uid == 0
            and not (mode.st_mode & stat.S_IWOTH), "unsafe_nginx_file")
    if updated == original:
        verify_route(origin)
        print("realtime_https_upgrade=ALREADY_READY")
        return
    atomic_replace(path, updated.encode(), stat.S_IMODE(mode.st_mode), mode.st_uid, mode.st_gid)
    try:
        run_command("/usr/sbin/nginx", "-t")
        run_command("/usr/bin/systemctl", "reload", "nginx")
        verify_route(origin)
    except Exception:
        atomic_replace(path, original.encode(), stat.S_IMODE(mode.st_mode), mode.st_uid, mode.st_gid)
        run_command("/usr/sbin/nginx", "-t")
        run_command("/usr/bin/systemctl", "reload", "nginx")
        raise
    print("realtime_https_upgrade=PASS")


if __name__ == "__main__":
    try:
        main()
    except RealtimeConfigError as error:
        print("realtime_https_upgrade=BLOCKED;reason=" + str(error))
        raise SystemExit(2)
    except Exception:
        print("realtime_https_upgrade=BLOCKED;reason=unexpected_error")
        raise SystemExit(2)
