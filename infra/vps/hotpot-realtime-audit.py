#!/usr/bin/python3
"""Read-only, redacted Nginx virtual-host and WSS route audit.

Owner-only pinned-SSH Actions command. Never prints certificates, server names,
Nginx config contents, credentials, or response bodies.
"""
import json
import os
from pathlib import Path
import re
import socket
import ssl
import subprocess
from urllib.parse import urlsplit

CONFIG = Path("/etc/sichuan-hotpot/release.json")
KEYS = (
    "nginx_tls_vhosts", "nginx_host_tls_vhosts",
    "nginx_host_tls_ws_locations", "nginx_host_tls_api_upstreams",
    "nginx_default_tls_vhosts", "nginx_tls_ws_locations",
    "backend_upgrade_status", "local_tls_upgrade_status",
    "public_tls_upgrade_status",
)


def blocks(config):
    """Extract server contexts with balanced braces, ignoring location braces."""
    starts = list(re.finditer(r"(?m)^\s*server\s*\{", config))
    result = []
    for match in starts:
        i, level, start = match.end(), 1, match.start()
        while i < len(config) and level:
            if config[i] == "{":
                level += 1
            elif config[i] == "}":
                level -= 1
            i += 1
        if level == 0:
            result.append(config[start:i])
    return result


def inspect(nginx_config, hostname):
    sites = blocks(nginx_config)
    tls = [s for s in sites if re.search(r"(?m)^\s*listen\s+[^;]*\b443\b[^;]*\bssl\b", s)]
    target = [s for s in tls if any(
        hostname in statement.split() for statement in
        re.findall(r"(?m)^\s*server_name\s+([^;]+);", s)
    )]
    ws = lambda s: bool(re.search(r"\blocation\s+(?:=\s*)?/realtime\s*\{", s))
    api = lambda s: bool(re.search(r"\bproxy_pass\s+http://127\.0\.0\.1:3000\s*;", s))
    return {
        "nginx_tls_vhosts": len(tls),
        "nginx_host_tls_vhosts": len(target),
        "nginx_host_tls_ws_locations": sum(ws(s) for s in target),
        "nginx_host_tls_api_upstreams": sum(api(s) for s in target),
        "nginx_default_tls_vhosts": sum(bool(re.search(r"\blisten\s+[^;]*\b443\b[^;]*\bdefault_server\b", s)) for s in tls),
        "nginx_tls_ws_locations": sum(ws(s) for s in tls),
    }


def probe(hostname, connect_to, port, tls):
    request = (
        "GET /realtime HTTP/1.1\r\nHost: " + hostname
        + "\r\nUpgrade: websocket\r\nConnection: Upgrade"
        + "\r\nSec-WebSocket-Version: 13"
        + "\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n"
    ).encode("ascii")
    try:
        with socket.create_connection((connect_to, port), timeout=5) as raw:
            if tls:
                with ssl.create_default_context().wrap_socket(raw, server_hostname=hostname) as secure:
                    secure.settimeout(5)
                    secure.sendall(request)
                    line = secure.recv(128).split(b"\r\n", 1)[0]
            else:
                raw.settimeout(5)
                raw.sendall(request)
                line = raw.recv(128).split(b"\r\n", 1)[0]
        match = re.fullmatch(rb"HTTP/1\.[01] ([0-9]{3})(?: .*)?", line)
        return int(match.group(1)) if match else 0
    except (OSError, ValueError, ssl.SSLError):
        return 0


def main():
    if os.geteuid() != 0:
        raise RuntimeError("requires_root")
    cfg = json.loads(CONFIG.read_text())
    parsed = urlsplit(cfg["https_base_url"])
    if not (parsed.scheme == "https" and parsed.hostname and parsed.port is None
            and parsed.path in ("", "/") and not parsed.username and not parsed.password):
        raise RuntimeError("unsafe_origin")
    nginx = subprocess.run(["/usr/sbin/nginx", "-T"], capture_output=True,
                           timeout=10, check=True)
    result = inspect(nginx.stdout.decode("utf8", errors="replace"), parsed.hostname)
    result.update({
        "backend_upgrade_status": probe(parsed.hostname, "127.0.0.1", 3000, False),
        "local_tls_upgrade_status": probe(parsed.hostname, "127.0.0.1", 443, True),
        "public_tls_upgrade_status": probe(parsed.hostname, parsed.hostname, 443, True),
    })
    if set(result) != set(KEYS) or any(type(v) is not int or not (0 <= v <= 999) for v in result.values()):
        raise RuntimeError("invalid_summary")
    for key in KEYS:
        print(key + "=" + str(result[key]))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("realtime_audit=BLOCKED")
        raise SystemExit(2)
