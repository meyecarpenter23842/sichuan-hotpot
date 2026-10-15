#!/usr/bin/python3
"""Manual immutable API release. No migration command is implemented here."""
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.parse
import fcntl
import pwd

ROOT = Path("/opt/sichuan-hotpot")
CONFIG = Path("/etc/sichuan-hotpot")
SERVICE = "hotpot-api.service"
# Only migration SQL from the pinned, reviewed main archive is deployable.
# Names are discovered from that archive; no per-version Python allowlist.
MIGRATION_SQL = re.compile(r"apps/api/prisma/migrations/([0-9]{14}_[a-z0-9_]+)/migration[.]sql\Z")
MANIFESTS = {"package.json", "package-lock.json", "apps/api/package.json",
             "apps/customer/package.json", "apps/admin/package.json",
             "packages/shared/package.json", "packages/ui/package.json"}
REQUIRED = MANIFESTS | {"apps/api/dist/main.js", "apps/api/prisma/schema.prisma",
                        "apps/api/prisma/migrations/migration_lock.toml"}


class ReleaseError(Exception):
    pass


def require(condition, code):
    if not condition:
        raise ReleaseError(code)


def valid_sha(sha):
    require(re.fullmatch(r"[0-9a-f]{40}", sha), "invalid_sha")


def archive_files(data):
    require(len(data) <= 64 * 1024 * 1024, "archive_too_large")
    result = {}
    total = 0
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        for member in archive:
            path = PurePosixPath(member.name)
            require(not path.is_absolute() and ".." not in path.parts
                    and "\\" not in member.name, "unsafe_archive_path")
            require(member.isfile() or member.isdir(), "unsafe_archive_entry")
            require(not any(part.startswith(".") or part == "node_modules"
                            for part in path.parts), "forbidden_archive_entry")
            if member.isdir():
                continue
            name = str(path)
            permitted = name in REQUIRED or (
                name.startswith(("apps/api/dist/", "packages/shared/dist/"))
                and name.endswith((".js", ".d.ts", ".js.map", ".d.ts.map"))) or bool(MIGRATION_SQL.fullmatch(name))
            require(permitted and name not in result, "unexpected_archive_file")
            total += member.size
            require(total <= 128 * 1024 * 1024 and len(result) < 2000, "archive_limits")
            result[name] = archive.extractfile(member).read()
    require(REQUIRED <= set(result), "incomplete_archive")
    migration_names(result)
    api = json.loads(result["apps/api/package.json"])
    require(api.get("name") == "@hotpot/api" and api.get("scripts", {}).get("start")
            == "node dist/main.js", "unexpected_api_manifest")
    return result


def migration_names(files):
    names = sorted(match.group(1) for name in files
                   if (match := MIGRATION_SQL.fullmatch(name)))
    require(len(names) > 0 and names[0].endswith("_init") and
            len(names) == len(set(names)), "invalid_migration_manifest")
    for name in names:
        require(bool(files["apps/api/prisma/migrations/" + name + "/migration.sql"].strip()),
                "empty_migration_sql")
    require(b'provider = "postgresql"' in
            files["apps/api/prisma/migrations/migration_lock.toml"],
            "invalid_migration_lock")
    return tuple(names)


def active_migration_names():
    root = ROOT / "current" / "apps/api/prisma/migrations"
    require(root.is_dir() and not root.is_symlink(), "active_migrations_missing")
    files = {"apps/api/prisma/migrations/migration_lock.toml":
             (root / "migration_lock.toml").read_bytes()}
    for directory in root.iterdir():
        if directory.is_dir() and not directory.is_symlink():
            sql_file = directory / "migration.sql"
            require(sql_file.is_file() and not sql_file.is_symlink(), "active_migration_invalid")
            files["apps/api/prisma/migrations/" + directory.name + "/migration.sql"] = sql_file.read_bytes()
    return migration_names(files)


def read_archive(sha, digest):
    valid_sha(sha)
    require(re.fullmatch(r"[0-9a-f]{64}", digest), "invalid_digest")
    path = ROOT / "incoming" / ("hotpot-api-" + sha + ".tgz")
    # O_NOFOLLOW rejects symlinks; a single fd binds checksum and parsing to one file.
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as source:
        data = source.read(64 * 1024 * 1024 + 1)
    require(hashlib.sha256(data).hexdigest() == digest, "checksum_mismatch")
    return archive_files(data)


def environment():
    path = CONFIG / "api.env"
    st = path.stat()
    require(st.st_uid == 0 and st.st_mode & 0o137 == 0, "unsafe_environment_permissions")
    result = {}
    for line in path.read_text().splitlines():
        if line and not line.startswith("#"):
            key, value = line.split("=", 1)
            require(key not in result, "duplicate_environment_variable")
            result[key] = value
    require(result.get("HOST") == "127.0.0.1" and result.get("PORT") == "3000",
            "unsafe_bind_configuration")
    require(len(result.get("AUTH_JWT_SECRET", "").encode()) >= 32,
            "jwt_secret_missing")
    require(result.get("GOOGLE_CLIENT_ID", "").endswith(".apps.googleusercontent.com"),
            "google_client_id_missing")
    require(bool(result.get("GOOGLE_CLIENT_SECRET")), "google_secret_missing")
    url = urllib.parse.urlsplit(result.get("DATABASE_URL", ""))
    require(url.scheme == "postgresql" and url.hostname == "127.0.0.1"
            and url.port == 5432 and url.username == "hotpot_app"
            and url.path == "/hotpot", "unsafe_database_configuration")
    return result


def db_schema_ready(env, required):
    url = urllib.parse.urlsplit(env["DATABASE_URL"])
    child_env = {"PATH": "/usr/bin:/bin", "PGPASSWORD": urllib.parse.unquote(url.password)}
    sql = "SELECT migration_name FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;"
    check = subprocess.run(["/usr/bin/psql", "-X", "-A", "-t", "-h", "127.0.0.1",
                            "-U", "hotpot_app", "-d", "hotpot", "-v", "ON_ERROR_STOP=1",
                            "-c", sql], env=child_env, capture_output=True, timeout=15)
    if check.returncode != 0 or not set(required) <= set(check.stdout.decode().splitlines()):
        return False
    failed = subprocess.run(["/usr/bin/psql", "-X", "-A", "-t", "-h", "127.0.0.1",
                             "-U", "hotpot_app", "-d", "hotpot", "-v", "ON_ERROR_STOP=1",
                             "-c", "SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL;"],
                            env=child_env, capture_output=True, timeout=15)
    protected_history = subprocess.run([
        "/usr/bin/psql", "-X", "-A", "-t", "-h", "127.0.0.1", "-U", "hotpot_app",
        "-d", "hotpot", "-v", "ON_ERROR_STOP=1", "-c",
        "SELECT NOT (has_table_privilege(current_user, 'public._prisma_migrations', 'INSERT') OR has_table_privilege(current_user, 'public._prisma_migrations', 'UPDATE') OR has_table_privilege(current_user, 'public._prisma_migrations', 'DELETE'));"
    ], env=child_env, capture_output=True, timeout=15)
    return (failed.returncode == 0 and failed.stdout.strip() == b"0"
            and protected_history.returncode == 0 and protected_history.stdout.strip() == b"t")


def release_settings():
    settings = json.loads((CONFIG / "release.json").read_text())
    url = settings.get("https_base_url", "")
    parts = urllib.parse.urlsplit(url)
    require(parts.scheme == "https" and parts.hostname and not parts.username
            and not parts.password and not parts.query and not parts.fragment
            and parts.path in ("", "/"), "https_not_configured")
    return url.rstrip("/")


def run(command, **kwargs):
    completed = subprocess.run(command, stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, **kwargs)
    require(completed.returncode == 0, "runtime_command_failed")


def prepare(sha, digest, files):
    target = ROOT / "releases" / sha
    marker = target / "release.json"
    if target.exists():
        require(not target.is_symlink() and marker.is_file(), "incomplete_existing_release")
        metadata = json.loads(marker.read_text())
        require(metadata == {"sha": sha, "digest": digest}, "existing_release_mismatch")
        return target
    build = pwd.getpwnam("hotpot-build")
    temporary = Path(tempfile.mkdtemp(prefix="prepare-", dir=ROOT / "staging"))
    os.chmod(temporary, 0o750)
    os.chown(temporary, build.pw_uid, build.pw_gid)
    for name, data in files.items():
        destination = temporary / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
    run(["chown", "-R", "hotpot-build:hotpot-build", str(temporary)])
    child_env = {"PATH": "/usr/bin:/bin", "HOME": "/var/lib/sichuan-hotpot/build",
                 "npm_config_cache": "/var/lib/sichuan-hotpot/build/cache",
                 "DATABASE_URL": "postgresql://unused:unused@127.0.0.1:5432/unused"}
    def build_run(command):
        run(["/usr/sbin/runuser", "-u", "hotpot-build", "--"] + command,
            cwd=temporary, env=child_env, timeout=600)
    backend_workspaces = ["--workspace=apps/api", "--workspace=packages/shared", "--include-workspace-root"]
    build_run(["npm", "ci"] + backend_workspaces + ["--include=dev", "--ignore-scripts", "--no-audit", "--no-fund"])
    build_run(["node", "node_modules/prisma/build/index.js", "generate", "--schema", "apps/api/prisma/schema.prisma"])
    build_run(["npm", "prune"] + backend_workspaces + ["--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"])
    build_run(["node", "-e", "require('@nestjs/core');require('@prisma/client');require('@node-rs/argon2');require('./apps/api/dist/app.module.js')"])
    (temporary / "release.json").write_text(json.dumps({"sha": sha, "digest": digest}))
    run(["chown", "-R", "root:hotpot-api", str(temporary)])
    # Preserve executable bits, deny write access to both runtime and builder.
    for directory, dirs, names in os.walk(temporary):
        os.chmod(directory, 0o750)
        for name in names:
            path = Path(directory) / name
            if not path.is_symlink():
                os.chmod(path, 0o750 if path.stat().st_mode & 0o111 else 0o640)
    os.rename(temporary, target)
    return target


def switch(current, target):
    pending = current.with_name("current.pending")
    require(not pending.exists() and not pending.is_symlink(), "pending_release_exists")
    os.symlink(target, pending)
    os.replace(pending, current)


def health(base):
    for _ in range(15):
        healthy = True
        for prefix in ("http://127.0.0.1:3000", base):
            for path in ("/health/live", "/health/ready"):
                check = subprocess.run(["curl", "--fail", "--silent", "--show-error",
                                        "--connect-timeout", "3", "--max-time", "5",
                                        "--output", "/dev/null", prefix + path],
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                healthy = healthy and check.returncode == 0
        if healthy:
            return True
        time.sleep(2)
    return False


def activate(current, target, restart, stop, check):
    require(not current.exists() or current.is_symlink(), "invalid_current_pointer")
    previous = current.resolve() if current.is_symlink() else None
    if previous:
        require(previous.parent == target.parent and previous.is_dir(), "invalid_previous_release")
    switch(current, target)
    try:
        restart()
        require(check(), "health_failed")
    except Exception:
        if previous:
            switch(current, previous)
            restart()
            require(check(), "rollback_health_failed")
        else:
            stop()
            current.unlink()
        raise ReleaseError("release_failed_rolled_back")
    return previous


def main(args):
    if os.geteuid() != 0:
        os.execvp("sudo", ["sudo", "-n", str(Path(__file__).resolve())] + args)
    with open("/run/lock/hotpot-api-release.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args == ["--check-config"]:
            results = {}
            try:
                env = environment()
                results["backend_environment"] = True
                results["migration_ready"] = db_schema_ready(env, active_migration_names())
            except ReleaseError as error:
                results[error.args[0]] = False
            try:
                release_settings()
                results["https_configured"] = True
            except ReleaseError:
                results["https_configured"] = False
            for name, ok in results.items():
                print(name + "=" + ("PASS" if ok else "BLOCKED"))
            return 0 if all(results.values()) else 2
        mode = "deploy"
        if args and args[0] in ("--verify-archive", "--prepare-only", "--rollback"):
            mode, args = args[0], args[1:]
        require(len(args) == (1 if mode == "--rollback" else 2), "invalid_arguments")
        sha = args[0]
        valid_sha(sha)
        if mode == "--rollback":
            target = ROOT / "releases" / sha
            require(target.is_dir() and not target.is_symlink() and (target / "release.json").is_file(), "rollback_release_missing")
        else:
            files = read_archive(sha, args[1])
            if mode == "--verify-archive":
                print("archive_validation=PASS")
                return 0
            if mode == "deploy":
                env = environment()
                require(db_schema_ready(env, migration_names(files)), "migration_not_ready")
                release_settings()
            target = prepare(sha, args[1], files)
            if mode == "--prepare-only":
                print("release_preparation=PASS;service_unchanged=yes;migration_run=no")
                return 0
        base = release_settings()
        require(db_schema_ready(environment(), active_migration_names() if mode == "--rollback" else migration_names(files)), "migration_not_ready")
        previous = activate(ROOT / "current", target,
                            lambda: run(["systemctl", "restart", SERVICE]),
                            lambda: run(["systemctl", "stop", SERVICE]),
                            lambda: health(base))
        print("release_sha=" + sha)
        print("health_live=PASS;health_ready=PASS")
        print("previous_release=" + (previous.name if previous else "none"))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except ReleaseError as error:
        print("release_error=" + error.args[0], file=sys.stderr)
        sys.exit(1)
    except Exception:
        print("release_error=operation_failed", file=sys.stderr)
        sys.exit(1)
