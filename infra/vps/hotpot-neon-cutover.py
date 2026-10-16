#!/usr/bin/python3
"""Finalize Neon cutover on the small VPS without exposing database credentials."""
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.parse

CONFIG = Path("/etc/sichuan-hotpot")
ENV_FILE = CONFIG / "api.env"
SWAP_FILE = Path("/swapfile")
SYSCTL_FILE = Path("/etc/sysctl.d/99-hotpot-memory.conf")


class CutoverError(Exception):
    pass


def require(value, reason):
    if not value:
        raise CutoverError(reason)


def read_environment():
    st = ENV_FILE.stat()
    require(st.st_uid == 0 and st.st_mode & 0o137 == 0, "unsafe_environment_permissions")
    values = {}
    for line in ENV_FILE.read_text().splitlines():
        if line and not line.startswith("#"):
            key, value = line.split("=", 1)
            require(key not in values, "duplicate_environment_variable")
            values[key] = value
    return values


def neon_process_env(values):
    url = urllib.parse.urlsplit(values.get("DATABASE_URL", ""))
    require(url.scheme == "postgresql" and url.hostname and url.username and url.password
            and url.port in (None, 5432) and url.path == "/hotpot"
            and url.hostname.endswith(".neon.tech"),
            "neon_database_configuration_required")
    params = urllib.parse.parse_qs(url.query, keep_blank_values=True)
    require(params.get("sslmode") == ["require"]
            and set(params) <= {"sslmode", "channel_binding"},
            "neon_database_configuration_required")
    host = url.hostname.replace("-pooler.", ".", 1)
    return {
        "PATH": "/usr/bin:/bin",
        "PGHOST": host,
        "PGPORT": str(url.port or 5432),
        "PGUSER": urllib.parse.unquote(url.username),
        "PGPASSWORD": urllib.parse.unquote(url.password),
        "PGDATABASE": "hotpot",
        "PGSSLMODE": "require",
    }


def run(command, *, env=None, input_bytes=None, capture=False, check=True, timeout=60):
    result = subprocess.run(
        command, env=env, input=input_bytes,
        stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
        stderr=subprocess.DEVNULL, timeout=timeout,
    )
    if check:
        require(result.returncode == 0, "command_failed")
    return result


def verify_neon(values):
    query = (
        "SELECT count(*) FROM public._prisma_migrations "
        "WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;"
    )
    result = run(
        ["/usr/bin/psql", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", query],
        env=neon_process_env(values), capture=True, timeout=30,
    )
    count = result.stdout.decode().strip()
    require(count.isdecimal() and int(count) > 0, "neon_schema_not_ready")


def health():
    return run(
        ["/usr/bin/curl", "--fail", "--silent", "--show-error",
         "--connect-timeout", "3", "--max-time", "5",
         "http://127.0.0.1:3000/health/ready"],
        check=False, timeout=10,
    ).returncode == 0


def ensure_swap():
    current = run(["/usr/sbin/swapon", "--show=NAME", "--noheadings"],
                  capture=True, timeout=10).stdout.decode().split()
    if not current:
        if SWAP_FILE.exists():
            st = SWAP_FILE.lstat()
            require(SWAP_FILE.is_file() and not SWAP_FILE.is_symlink()
                    and st.st_uid == 0 and st.st_mode & 0o077 == 0,
                    "unsafe_swapfile")
        else:
            run(["/usr/bin/fallocate", "-l", "2G", str(SWAP_FILE)], timeout=60)
            os.chmod(SWAP_FILE, 0o600)
            run(["/usr/sbin/mkswap", str(SWAP_FILE)], timeout=30)
        run(["/usr/sbin/swapon", str(SWAP_FILE)], timeout=30)

    fstab = Path("/etc/fstab")
    lines = fstab.read_text().splitlines()
    swap_lines = [line for line in lines if line.split()[:1] == [str(SWAP_FILE)]]
    require(not swap_lines or swap_lines == ["/swapfile none swap sw 0 0"],
            "conflicting_swap_configuration")
    if not swap_lines:
        with fstab.open("a") as handle:
            handle.write("/swapfile none swap sw 0 0\n")

    SYSCTL_FILE.write_text("vm.swappiness=10\n")
    os.chmod(SYSCTL_FILE, 0o644)
    run(["/usr/sbin/sysctl", "-q", "-p", str(SYSCTL_FILE)], timeout=10)

    total = run(["/usr/sbin/swapon", "--show=SIZE", "--bytes", "--noheadings"],
                capture=True, timeout=10).stdout.decode().split()
    require(total and any(item.isdecimal() and int(item) >= 1024**3 for item in total),
            "swap_not_active")


def disable_local_postgres():
    units = ["postgresql@16-main.service", "postgresql.service"]
    active_before = any(
        run(["/usr/bin/systemctl", "is-active", "--quiet", unit],
            check=False, timeout=10).returncode == 0
        for unit in units
    )
    for unit in units:
        run(["/usr/bin/systemctl", "disable", "--now", unit],
            check=False, timeout=30)

    listening = run(["/usr/bin/ss", "-lnt"], capture=True, timeout=10).stdout.decode()
    require(not re.search(r"(^|[\s:])5432\s", listening), "local_postgres_still_listening")
    return active_before


def restore_local_postgres():
    run(["/usr/bin/systemctl", "enable", "--now", "postgresql@16-main.service"],
        check=False, timeout=30)


def main():
    require(os.geteuid() == 0, "root_required")
    values = read_environment()
    verify_neon(values)
    require(health(), "api_unhealthy_before_cutover")
    print("neon_database=PASS", flush=True)

    ensure_swap()
    print("swap_guard=PASS", flush=True)

    was_active = disable_local_postgres()
    if not health():
        if was_active:
            restore_local_postgres()
        raise CutoverError("api_unhealthy_after_postgres_stop")
    print("local_postgresql=DISABLED", flush=True)
    print("api_health=PASS", flush=True)


if __name__ == "__main__":
    try:
        main()
    except CutoverError as exc:
        print("cutover=BLOCKED;reason=" + str(exc), file=sys.stderr)
        sys.exit(2)
    except Exception:
        print("cutover=BLOCKED;reason=operation_failed", file=sys.stderr)
        sys.exit(2)
