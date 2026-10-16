#!/usr/bin/python3
"""Owner-only append-only migrations from a reviewed archive; R2 restore verified first."""
import fcntl
import hashlib
import importlib.util
from importlib.machinery import SourceFileLoader
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import tempfile
import time
import urllib.parse

ROOT = Path("/opt/sichuan-hotpot")
CONFIG = Path("/etc/sichuan-hotpot")
BACKUPS = Path("/var/lib/sichuan-hotpot/p4-backups")
KEY = CONFIG / "p3-recovery.key"
RCLONE = CONFIG / "p3-rclone.conf"
SETTINGS = CONFIG / "p3-backup.json"
RELEASE_HELPER = Path("/usr/local/sbin/hotpot-api-release-manual")
BUCKET = "hotpot-db-backups-private"


class GateError(Exception):
    pass


def require(value, reason):
    if not value:
        raise GateError(reason)


def sha256_file(path):
    """Hash large encrypted backups in bounded memory (1 MiB chunks)."""
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def private_file(path):
    path = Path(path)
    st = path.lstat()
    require(path.is_file() and not path.is_symlink() and st.st_uid == 0
            and st.st_mode & 0o077 == 0, "private_file_permissions")
    return path


def run(args, *, env=None, cwd=None, input_bytes=None, timeout=600, capture=False):
    value = subprocess.run(args, input=input_bytes, cwd=cwd, env=env, timeout=timeout,
                           stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL)
    require(value.returncode == 0, "command_failed")
    return value.stdout if capture else b""


def production_database_url(database="hotpot"):
    values = {}
    for line in (CONFIG / "api.env").read_text().splitlines():
        if line and not line.startswith("#"):
            key, value = line.split("=", 1)
            require(key not in values, "duplicate_environment_variable")
            values[key] = value
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
    user = urllib.parse.quote(urllib.parse.unquote(url.username), safe="")
    password = urllib.parse.quote(urllib.parse.unquote(url.password), safe="")
    db = urllib.parse.quote(database, safe="")
    return f"postgresql://{user}:{password}@{host}:{url.port or 5432}/{db}?sslmode=require"


def database_process_env(database="hotpot"):
    url = urllib.parse.urlsplit(production_database_url(database))
    return {
        "PATH": "/usr/bin:/bin",
        "PGHOST": url.hostname,
        "PGPORT": str(url.port or 5432),
        "PGUSER": urllib.parse.unquote(url.username),
        "PGPASSWORD": urllib.parse.unquote(url.password),
        "PGDATABASE": database,
        "PGSSLMODE": "require",
    }


def sql(query, database="hotpot"):
    return run(["/usr/bin/psql", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1",
                "-c", query], env=database_process_env(database),
               timeout=30, capture=True).decode().strip()


def sql_write(query, database="hotpot"):
    run(["/usr/bin/psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", "-"],
        env=database_process_env(database), input_bytes=query.encode(), timeout=30)


def checked_history(expected):
    data = sql("SELECT migration_name || '|' || checksum || '|' || "
               "(finished_at IS NOT NULL)::text || '|' || "
               "(rolled_back_at IS NOT NULL)::text FROM public._prisma_migrations;")
    applied = set()
    for row in data.splitlines():
        columns = row.split("|")
        require(len(columns) == 4, "malformed_migration_history")
        name, digest, finished, rolled = columns
        require(name in expected and digest == expected[name]
                and finished == "true" and rolled == "false" and name not in applied,
                "unsafe_migration_history")
        applied.add(name)
    names = sorted(expected)
    require(names and names[0] in applied, "base_migration_missing")
    require(applied in (set(names[:n]) for n in range(1, len(names) + 1)),
            "migration_order_invalid")
    return applied


def checked_source(sha, digest):
    require(re.fullmatch(r"[0-9a-f]{40}", sha) and
            re.fullmatch(r"[0-9a-f]{64}", digest), "invalid_source")
    path = ROOT / "incoming" / ("hotpot-api-" + sha + ".tgz")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as f:
        blob = f.read(64 * 1024 * 1024 + 1)
    require(hashlib.sha256(blob).hexdigest() == digest, "source_checksum_mismatch")
    st = RELEASE_HELPER.lstat()
    require(RELEASE_HELPER.is_file() and not RELEASE_HELPER.is_symlink()
            and st.st_uid == 0 and st.st_mode & 0o022 == 0, "unsafe_release_helper")
    loader = SourceFileLoader("hotpot_release", str(RELEASE_HELPER))
    spec = importlib.util.spec_from_loader("hotpot_release", loader)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    files = module.archive_files(blob)
    names = module.migration_names(files)
    hashes = {}
    for name in names:
        p = "apps/api/prisma/migrations/" + name + "/migration.sql"
        require(p in files, "unreviewed_migration_source")
        hashes[name] = hashlib.sha256(files[p]).hexdigest()
    return files, hashes


def backup_config():
    cfg = json.loads(private_file(SETTINGS).read_text())
    private_file(RCLONE)
    private_file(KEY)
    require(cfg == {"bucket": BUCKET, "remote": "hotpot-r2",
                    "recipient": cfg.get("recipient"), "offline_recovery_confirmed": True},
            "backup_configuration_missing")
    require(isinstance(cfg["recipient"], str) and
            re.fullmatch(r"age1[0-9a-z]{58}", cfg["recipient"]), "invalid_recipient")
    identity_recipient = run(["/usr/bin/age-keygen", "-y", str(KEY)],
                             capture=True, timeout=10).decode().strip()
    require(identity_recipient == cfg["recipient"], "recovery_key_mismatch")
    env = {"PATH": "/usr/bin:/bin", "HOME": "/root", "RCLONE_CONFIG": str(RCLONE)}
    remote = "hotpot-r2:" + BUCKET
    run(["/usr/bin/rclone", "lsf", remote, "--max-depth", "1"], env=env, timeout=60)
    return cfg, env, remote


def encrypt_dump(target, recipient):
    with target.open("xb") as dest:
        os.chmod(target, 0o600)
        dump = subprocess.Popen(["/usr/bin/pg_dump", "-Fc"],
                                env=database_process_env("hotpot"),
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        try:
            encrypt = subprocess.Popen(["/usr/bin/age", "-r", recipient],
                                       stdin=dump.stdout, stdout=dest,
                                       stderr=subprocess.DEVNULL)
            dump.stdout.close()
            status_encrypt = encrypt.wait(timeout=600)
            status_dump = dump.wait(timeout=600)
            require(status_dump == 0 and status_encrypt == 0, "backup_encryption_failed")
        finally:
            if dump.poll() is None:
                dump.kill()
                dump.wait()
        dest.flush()
        os.fsync(dest.fileno())
    return sha256_file(target)


def wait_for_database(database, timeout=30):
    """Neon database routing can lag briefly after CREATE DATABASE."""
    deadline = time.monotonic() + timeout
    env = database_process_env(database)
    while time.monotonic() < deadline:
        probe = subprocess.run(
            ["/usr/bin/psql", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1",
             "-c", "SELECT 1;"],
            env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            timeout=10,
        )
        if probe.returncode == 0:
            return
        time.sleep(1)
    raise GateError("isolated_database_not_ready")


def restore_failure_reason(stderr):
    """Reduce pg_restore stderr to a fixed non-secret diagnostic code."""
    text = stderr.decode(errors="replace").lower()
    if "permission denied" in text or "must be owner" in text:
        return "isolated_restore_permission"
    if "already exists" in text:
        return "isolated_restore_conflict"
    if "unrecognized configuration parameter" in text:
        return "isolated_restore_compatibility"
    if "database" in text and "does not exist" in text:
        return "isolated_restore_database_missing"
    if "connection to server" in text or "server closed the connection" in text:
        return "isolated_restore_connection"
    if "could not execute query" in text:
        return "isolated_restore_query_failed"
    return "isolated_restore_failed"


def verify_decryption(cipher):
    result = subprocess.run(
        ["/usr/bin/age", "-d", "-i", str(KEY), str(cipher)],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=600,
    )
    require(result.returncode == 0, "isolated_decrypt_failed")


def isolated_restore(cipher):
    name = "hotpot_p4_restore_" + secrets.token_hex(7)
    sql_write("CREATE DATABASE " + name + " TEMPLATE template0;")
    try:
        wait_for_database(name)
        sql_write("REVOKE ALL ON DATABASE " + name + " FROM PUBLIC;")
        # Neon creates the default public schema. Reset only this disposable DB
        # before restore so pg_restore never collides with pre-existing objects.
        sql_write("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;", name)
        # Verify the encrypted round-trip independently. If pg_restore exits
        # early later, age can receive SIGPIPE; that must not be misreported
        # as a recovery-key failure.
        verify_decryption(cipher)
        decrypt = subprocess.Popen(["/usr/bin/age", "-d", "-i", str(KEY), str(cipher)],
                                   stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        try:
            with tempfile.TemporaryFile() as restore_errors:
                restore = subprocess.Popen([
                    "/usr/bin/pg_restore", "--exit-on-error",
                    "--clean", "--if-exists", "--no-owner", "--no-acl",
                ], env=database_process_env(name),
                   stdin=decrypt.stdout, stdout=subprocess.DEVNULL,
                   stderr=restore_errors)
                decrypt.stdout.close()
                status_restore = restore.wait(timeout=600)
                status_decrypt = decrypt.wait(timeout=600)
                if status_restore != 0:
                    restore_errors.seek(0)
                    raise GateError(restore_failure_reason(restore_errors.read()))
                require(status_decrypt == 0, "isolated_decrypt_failed")
        finally:
            if decrypt.poll() is None:
                decrypt.kill()
                decrypt.wait()
        for table in ("User", "Order", "Payment"):
            require(sql('SELECT count(*) FROM public."' + table + '";', name).isdecimal(),
                    "isolated_reconciliation_failed")
        return name
    finally:
        sql_write("SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                  "WHERE datname='" + name + "' AND pid <> pg_backend_pid(); "
                  "DROP DATABASE IF EXISTS " + name + ";")


def backup_restore(sha):
    cfg, env, remote = backup_config()
    BACKUPS.mkdir(mode=0o700, parents=True, exist_ok=True)
    require(not BACKUPS.is_symlink() and BACKUPS.stat().st_uid == 0
            and BACKUPS.stat().st_mode & 0o077 == 0, "backup_folder_permissions")
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()) + "-" + secrets.token_hex(6)
    filename = stamp + ".dump.age"
    ciphertext = BACKUPS / filename
    digest = encrypt_dump(ciphertext, cfg["recipient"])
    dest = remote + "/p4/" + filename
    run(["/usr/bin/rclone", "copyto", "--immutable", str(ciphertext), dest],
        env=env, timeout=600)
    roundtrip = BACKUPS / (stamp + ".download.age")
    try:
        run(["/usr/bin/rclone", "copyto", dest, str(roundtrip)], env=env, timeout=600)
        require(sha256_file(roundtrip) == digest,
                "offsite_download_checksum_mismatch")
        restored = isolated_restore(roundtrip)
    finally:
        roundtrip.unlink(missing_ok=True)
    receipt = BACKUPS / (stamp + ".json")
    with receipt.open("x") as out:
        os.chmod(receipt, 0o600)
        json.dump({"sha": sha, "created_at": int(time.time()),
                   "r2_object": "p4/" + filename, "sha256": digest,
                   "offsite_verified": True, "restore_verified": True,
                   "restore_database": restored, "consumed": False}, out)
        out.flush()
        os.fsync(out.fileno())
    print("backup=PASS;offsite=PASS;isolated_restore=PASS;backup_id=" + stamp, flush=True)
    return receipt


def migrate(files, expected):
    if set(expected) <= checked_history(expected):
        print("migration=ALREADY_APPLIED", flush=True)
        return
    business_counts = {table: int(sql('SELECT count(*) FROM public."' + table + '";'))
                       for table in ("User", "Order", "Payment")}
    work = ROOT / "db-work"
    work.mkdir(mode=0o711, parents=True, exist_ok=True)
    require(not work.is_symlink() and work.stat().st_uid == 0, "work_directory_permissions")
    os.chmod(work, 0o711)
    path = Path(tempfile.mkdtemp(prefix="hotpot-migrate-", dir=work))
    for name, contents in files.items():
        file = path / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(contents)
    run(["/usr/bin/chown", "-R", "hotpot-build:hotpot-build", str(path)])
    env = {"PATH": "/usr/bin:/bin", "HOME": "/var/lib/sichuan-hotpot/build",
           "npm_config_cache": "/var/lib/sichuan-hotpot/build/cache",
           "DATABASE_URL": "postgresql://unused:unused@127.0.0.1:5432/unused"}
    npm = ["/usr/sbin/runuser", "-u", "hotpot-build", "--", "/usr/bin/npm"]
    run(npm + ["ci", "--workspace=apps/api", "--workspace=packages/shared",
               "--include-workspace-root", "--ignore-scripts", "--no-audit", "--no-fund"],
        env=env, cwd=path, timeout=600)
    node = ["/usr/sbin/runuser", "-u", "hotpot-build", "--", "/usr/bin/node",
            str(path / "node_modules/prisma/build/index.js")]
    schema = str(path / "apps/api/prisma/schema.prisma")
    run(node + ["generate", "--schema", schema], env=env, cwd=path, timeout=300)
    prod_env = dict(env, DATABASE_URL=production_database_url("hotpot"))
    run(node + ["migrate", "deploy", "--schema", schema],
        env=prod_env, cwd=path, timeout=600)
    run(node + ["migrate", "status", "--schema", schema],
        env=prod_env, cwd=path, timeout=90)
    run(node + ["migrate", "diff", "--from-schema-datasource", schema,
                "--to-schema-datamodel", schema, "--exit-code"],
        env=prod_env, cwd=path, timeout=120)
    require(set(expected) <= checked_history(expected), "migration_history_incomplete")
    # Prisma migrate status + schema diff already verify every version,
    # including migrations not yet known when this runner was committed.
    # Existing business records must survive the additive migration.
    for table, before in business_counts.items():
        after = int(sql('SELECT count(*) FROM public."' + table + '";'))
        require(after >= before, "business_data_reconciliation_failed")
    print("migration=PASS;schema_drift=PASS", flush=True)


def main(args):
    require(os.geteuid() == 0, "root_required")
    os.umask(0o077)
    require((len(args) == 2 and args[0] == "--backup") or
            (len(args) == 3 and args[0] in ("--check", "--release")),
            "invalid_arguments")
    with open("/run/lock/hotpot-api-release.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args[0] == "--backup":
            require(re.fullmatch(r"[0-9a-f]{40}", args[1]), "invalid_source")
            backup_restore(args[1])
            return
        _, sha, digest = args
        files, hashes = checked_source(sha, digest)
        applied = checked_history(hashes)
        backup_config()
        if args[0] == "--check":
            print("migration_preflight=PASS;pending=" + str(len(set(hashes) - applied)), flush=True)
            return
        if set(hashes) <= applied:
            print("migration=ALREADY_APPLIED", flush=True)
            return
        # A complete, independent backup+R2 download+isolated restore must
        # succeed before any migration transaction touches production.
        receipt = backup_restore(sha)
        # Single-use proof is consumed BEFORE any migration command. If a
        # migration commits and a later health/schema validation fails, the
        # receipt must never remain reusable for an unsafe blind retry.
        proof = json.loads(private_file(receipt).read_text())
        proof["consumed"] = True
        with receipt.open("r+") as handle:
            handle.seek(0)
            json.dump(proof, handle)
            handle.truncate()
            handle.flush()
            os.fsync(handle.fileno())
        migrate(files, hashes)
        print("migration_database_ready=PASS", flush=True)


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except GateError as exc:
        print("migration_operation=BLOCKED;reason=" + str(exc), file=sys.stderr)
        sys.exit(2)
    except Exception:
        print("migration_operation=BLOCKED;reason=operation_failed", file=sys.stderr)
        sys.exit(2)
