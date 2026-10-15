#!/usr/bin/python3
"""Read-only, redacted configuration diagnosis for image uploads and road routing.

Never print env values, URLs containing keys, private paths, credentials or customer data.
"""
import os
from pathlib import Path
import re
import socket

API_ENV = Path("/etc/sichuan-hotpot/api.env")
FIELDS = ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY",
          "R2_BUCKET", "GOOGLE_ROUTES_API_KEY")


def statuses(contents: str) -> dict[str, str]:
    keys: dict[str, list[str]] = {name: [] for name in FIELDS}
    for row in contents.splitlines():
        row = row.strip()
        if not row or row.startswith("#"):
            continue
        if row.startswith("export "):
            row = row[7:]
        name, sep, value = row.partition("=")
        if sep and name.strip() in keys:
            value = value.strip().strip("\'\"")
            keys[name.strip()].append(value)
    results: dict[str, str] = {}
    for key, values in keys.items():
        if not values:
            results[key] = "MISSING"
        elif len(values) != 1:
            results[key] = "DUPLICATE"
        elif not values[0]:
            results[key] = "EMPTY"
        elif key == "R2_ACCOUNT_ID" and not re.fullmatch(r"[A-Fa-f0-9]{32}", values[0]):
            results[key] = "INVALID_FORMAT"
        elif key == "R2_BUCKET" and values[0] != "hot-pot":
            results[key] = "WRONG_BUCKET"
        elif key == "R2_ACCESS_KEY_ID" and not re.fullmatch(r"[a-zA-Z0-9]{12,128}", values[0]):
            results[key] = "INVALID_FORMAT"
        elif key == "R2_SECRET_ACCESS_KEY" and len(values[0]) < 20:
            results[key] = "INVALID_FORMAT"
        else:
            results[key] = "PRESENT"
    return results


def main() -> None:
    if os.geteuid() != 0:
        raise RuntimeError("root_required")
    if not API_ENV.is_file():
        print("api_env=NOT_FOUND")
        raise SystemExit(2)
    print("api_env=FOUND")
    for key, state in statuses(API_ENV.read_text()).items():
        print(key.lower() + "=" + state)
    for label, hostname in (("r2_dns", "cloudflare.com"),
                            ("routes_dns", "routes.googleapis.com")):
        try:
            socket.getaddrinfo(hostname, 443)
            state = "RESOLVES"
        except (OSError, ValueError):
            state = "FAIL"
        print(label + "=" + state)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("services_audit=BLOCKED")
        raise SystemExit(2)
