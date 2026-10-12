#!/usr/bin/python3
"""One-time provisioning after inventory, package install and operator approval."""
import grp
import json
import os
from pathlib import Path
import pwd
import re
import secrets
import subprocess
import sys


def run(command, **kwargs):
    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kwargs)
    if result.returncode:
        raise RuntimeError("provision_command_failed_" + Path(command[0]).name)
    return result.stdout.decode().strip()


def postgres(sql):
    return run(["runuser", "-u", "postgres", "--", "psql", "-X", "-A", "-t",
                "-v", "ON_ERROR_STOP=1", "-d", "postgres"],
               input=("SET log_statement='none'; SET log_min_error_statement='panic';\n" + sql).encode())


def main():
    if os.geteuid() != 0:
        raise RuntimeError("root_required")
    google_id = sys.argv[1]
    if not re.fullmatch(r"[A-Za-z0-9_-]+\.apps\.googleusercontent\.com", google_id):
        raise ValueError("invalid_google_client_id")
    env_file = Path("/etc/sichuan-hotpot/api.env")
    if env_file.exists():
        raise RuntimeError("existing_environment_requires_review")
    for account, home in (("hotpot-api", "/opt/sichuan-hotpot"),
                          ("hotpot-build", "/var/lib/sichuan-hotpot/build")):
        try:
            pwd.getpwnam(account)
        except KeyError:
            run(["useradd", "--system", "--user-group", "--home-dir", home,
                 "--shell", "/usr/sbin/nologin", account])
    for path, mode, owner in (("/opt/sichuan-hotpot", "0755", "root"),
                              ("/opt/sichuan-hotpot/releases", "0755", "root"),
                              ("/opt/sichuan-hotpot/staging", "0711", "root"),
                              ("/opt/sichuan-hotpot/incoming", "0700", "ubuntu"),
                              ("/etc/sichuan-hotpot", "0750", "root"),
                              ("/var/lib/sichuan-hotpot/build", "0700", "hotpot-build"),
                              ("/var/lib/sichuan-hotpot/acme", "0755", "root")):
        run(["install", "-d", "-m", mode, "-o", owner, "-g", owner, path])
    os.chown(env_file.parent, 0, grp.getgrnam("hotpot-api").gr_gid)
    pg_config = Path("/etc/postgresql/16/main/postgresql.conf")
    contents, count = re.subn(r"(?m)^listen_addresses\s*=.*$",
                              "listen_addresses = '127.0.0.1'", pg_config.read_text())
    if count > 1:
        raise RuntimeError("duplicate_postgres_bind_configuration")
    if count == 0:
        contents += "\nlisten_addresses = '127.0.0.1'\n"
    pg_config.write_text(contents)
    # Inventory established there are no pre-existing clusters/application DBs.
    run(["systemctl", "start", "postgresql@16-main.service"])
    existing = postgres("SELECT count(*) FROM pg_roles WHERE rolname IN ('hotpot_app','hotpot_owner');")
    if not existing.splitlines()[-1] == "0":
        raise RuntimeError("existing_hotpot_roles_require_review")
    password = secrets.token_hex(32)
    postgres("CREATE ROLE hotpot_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;\n"
             "CREATE ROLE hotpot_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '" + password + "';\n"
             "CREATE DATABASE hotpot OWNER hotpot_owner;\n"
             "REVOKE ALL ON DATABASE hotpot FROM PUBLIC; GRANT CONNECT ON DATABASE hotpot TO hotpot_app;")
    sql = """REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO hotpot_app;
ALTER DEFAULT PRIVILEGES FOR ROLE hotpot_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hotpot_app;
ALTER DEFAULT PRIVILEGES FOR ROLE hotpot_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO hotpot_app;
"""
    run(["runuser", "-u", "postgres", "--", "psql", "-X", "-v", "ON_ERROR_STOP=1", "-d", "hotpot"], input=sql.encode())
    fd = os.open(env_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o640)
    os.fchown(fd, 0, grp.getgrnam("hotpot-api").gr_gid)
    with os.fdopen(fd, "w") as output:
        output.write("NODE_ENV=production\nHOST=127.0.0.1\nPORT=3000\n"
                     "DATABASE_URL=postgresql://hotpot_app:" + password + "@127.0.0.1:5432/hotpot?schema=public\n"
                     "GOOGLE_CLIENT_ID=" + google_id + "\nAUTH_JWT_SECRET=" + secrets.token_hex(48) + "\n")
    settings = Path("/etc/sichuan-hotpot/release.json")
    fd = os.open(settings, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as output:
        json.dump({"https_base_url": ""}, output)
    private_env = {"PATH": "/usr/bin:/bin", "PGPASSWORD": password}
    result = run(["psql", "-X", "-A", "-t", "-h", "127.0.0.1", "-U", "hotpot_app",
                  "-d", "hotpot", "-c", "SELECT 1;"], env=private_env)
    if result != "1":
        raise RuntimeError("database_connection_failed")
    print("database_created=PASS;app_role_login=PASS;application_migrations_run=no")
    print("database_url_configured=PASS;jwt_secret_generated=PASS;google_client_id_configured=PASS")


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as error:
        print("provisioning=FAIL;stage=" + str(error), file=sys.stderr)
        sys.exit(1)
    except Exception:
        print("provisioning=FAIL;inspect_locally_without_printing_secrets", file=sys.stderr)
        sys.exit(1)
