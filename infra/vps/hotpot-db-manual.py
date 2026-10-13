#!/usr/bin/python3
"""First-release DB operations only. No production mutation without local approval.

Backups stay encrypted on VPS/offsite; neither dump nor recovery key enters CI.
Restore databases are retained, isolated and locked after the drill.
"""
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

CONFIG = Path('/etc/sichuan-hotpot')
BACKUPS = Path('/var/lib/sichuan-hotpot/backups')
WORK = Path('/opt/sichuan-hotpot/db-work')
INCOMING = Path('/opt/sichuan-hotpot/incoming')
RELEASE_HELPER = Path('/usr/local/sbin/hotpot-api-release-manual')


class GateError(Exception):
    pass


def require(ok, code):
    if not ok:
        raise GateError(code)


def private_file(path):
    path = Path(path)
    st = path.lstat()
    require(path.is_file() and not path.is_symlink() and st.st_uid == 0
            and st.st_mode & 0o077 == 0, 'unsafe_private_file')
    return path


def settings():
    value = json.loads(private_file(CONFIG / 'backup.json').read_text())
    require(re.fullmatch(r'age1[0-9a-z]{58}', value.get('age_recipient', '')),
            'backup_recipient_missing')
    require(value.get('offsite_mode') == 'windows-pull', 'offsite_mode_missing')
    require(Path('/usr/bin/age').is_file(), 'age_not_installed')
    return value


def call(command, data=None, env=None, timeout=600, cwd=None):
    result = subprocess.run(command, input=data, env=env, cwd=cwd, capture_output=True, timeout=timeout)
    require(result.returncode == 0, 'command_failed')
    return result.stdout


def pg(sql, database='postgres'):
    # Never print SQL/exception output, particularly transient role passwords.
    return call(['/usr/sbin/runuser', '-u', 'postgres', '--', '/usr/bin/psql',
                 '-XAt', '-v', 'ON_ERROR_STOP=1', '-d', database],
                ("SET log_statement='none'; SET log_min_error_statement='panic';\n" + sql).encode())


def quiet_sql(sql, database='postgres'):
    return pg(sql, database).decode().splitlines()


def offline_empty():
    state = subprocess.run(['systemctl', 'is-active', 'hotpot-api.service'], capture_output=True)
    require(state.stdout.strip() in (b'inactive', b'failed'), 'api_must_be_inactive')
    require(not Path('/opt/sichuan-hotpot/current').is_symlink(), 'first_release_only')
    result = quiet_sql("SELECT count(*) FROM pg_stat_activity WHERE datname='hotpot';")
    require(result[-1] == '0', 'database_clients_present')
    require(quiet_sql("SELECT count(*) FROM pg_tables WHERE schemaname='public';", 'hotpot')[-1]
            == '0', 'initial_empty_database_required')


def fingerprint(database):
    schema = call(['/usr/sbin/runuser', '-u', 'postgres', '--', '/usr/bin/pg_dump',
                   '--schema-only', '--no-owner', '--no-acl', '-d', database])
    # PostgreSQL's generated psql safety token changes between dumps.
    schema = b'\n'.join(line for line in schema.splitlines()
                        if not line.startswith((b'\\restrict ', b'\\unrestrict ')))
    tables = quiet_sql("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;", database)
    counts = []
    for table in tables:
        if table == 'SET':
            continue
        quoted = '"' + table.replace('"', '""') + '"'
        counts.append((table, quiet_sql('SELECT count(*) FROM public.' + quoted + ';', database)[-1]))
    return hashlib.sha256(schema + json.dumps(counts).encode()).hexdigest()


def pipe(command1, command2, output=None, env2=None, env1=None):
    first = subprocess.Popen(command1, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env1)
    try:
        second = subprocess.run(command2, stdin=first.stdout, stdout=output or subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL, env=env2, timeout=600)
        first.stdout.close()
        require(first.wait(timeout=30) == 0 and second.returncode == 0, 'backup_restore_pipeline_failed')
    finally:
        if first.poll() is None:
            first.kill()
            first.wait()


def backup(sha):
    cfg = settings()
    offline_empty()
    before = fingerprint('hotpot')
    stamp = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()) + '-' + secrets.token_hex(4)
    BACKUPS.mkdir(mode=0o700, parents=True, exist_ok=True)
    require(BACKUPS.stat().st_uid == 0 and BACKUPS.stat().st_mode & 0o077 == 0, 'unsafe_backup_directory')
    target = BACKUPS / (stamp + '.dump.age')
    with target.open('xb') as output:
        os.chmod(target, 0o600)
        pipe(['/usr/sbin/runuser', '-u', 'postgres', '--', '/usr/bin/pg_dump', '-Fc', '-d', 'hotpot'],
             ['/usr/bin/age', '-r', cfg['age_recipient']], output=output)
        output.flush()
        os.fsync(output.fileno())
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    # An encrypted export is accessible only to the already authorized SSH operator.
    import pwd
    export = INCOMING / (stamp + '.dump.age')
    with export.open('xb') as output:
        output.write(target.read_bytes())
    user = pwd.getpwnam('ubuntu')
    os.chown(export, user.pw_uid, user.pw_gid)
    os.chmod(export, 0o600)
    proof = {'sha': sha, 'created_at': int(time.time()), 'encrypted_sha256': digest,
             'offsite_verified': False, 'restore_verified': False, 'fingerprint': before,
             'consumed': False}
    write_json(BACKUPS / (stamp + '.json'), proof)
    print('backup=PASS;backup_id=' + stamp + ';sha256=' + digest + ';production_migration_run=no')


def restore(backup_id, digest):
    require(re.fullmatch(r'[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}', backup_id), 'invalid_backup_id')
    cfg = settings()
    offline_empty()
    proof_path = private_file(BACKUPS / (backup_id + '.json'))
    proof = json.loads(proof_path.read_text())
    require(proof['encrypted_sha256'] == digest and not proof['consumed'], 'invalid_offsite_receipt')
    # Windows reuploads the checksum-verified offsite copy before initiating this drill.
    recovered = INCOMING / (backup_id + '.restore.age')
    fd = os.open(recovered, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as source:
        encrypted = source.read(64 * 1024 * 1024 + 1)
    require(len(encrypted) <= 64 * 1024 * 1024 and hashlib.sha256(encrypted).hexdigest() == digest,
            'recovered_checksum_failed')
    before = proof['fingerprint']
    require(fingerprint('hotpot') == before, 'database_changed_since_backup')
    identity = sys.stdin.buffer.read(4097)
    require(len(identity) <= 4096 and b'AGE-SECRET-KEY-' in identity, 'recovery_identity_missing')
    name = 'hotpot_restore_' + secrets.token_hex(8)
    password = secrets.token_hex(32)
    quiet_sql("CREATE ROLE " + name + " LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '" + password + "';")
    try:
        quiet_sql('CREATE DATABASE ' + name + ' OWNER ' + name + ' TEMPLATE template0;')
        quiet_sql('REVOKE ALL ON DATABASE ' + name + ' FROM PUBLIC;')
        # Identity exists only in root's private /run temporary directory, then is unlinked.
        with tempfile.TemporaryDirectory(prefix='hotpot-recovery-', dir='/run') as directory:
            key = Path(directory) / 'identity'
            key.write_bytes(identity)
            os.chmod(key, 0o600)
            require(call(['/usr/bin/age-keygen', '-y', str(key)]).decode().strip()
                    == cfg['age_recipient'], 'recovery_identity_mismatch')
            cipher = Path(directory) / 'recovered.age'
            cipher.write_bytes(encrypted)
            pipe(['/usr/bin/age', '-d', '-i', str(key), str(cipher)],
                 ['/usr/bin/pg_restore', '--exit-on-error', '--no-owner', '--no-acl',
                  '-h', '127.0.0.1', '-U', name, '-d', name],
                 env2={'PATH': '/usr/bin:/bin', 'PGPASSWORD': password})
        require(fingerprint(name) == before and fingerprint('hotpot') == before,
                'restore_reconciliation_failed')
    finally:
        quiet_sql('ALTER ROLE ' + name + ' NOLOGIN PASSWORD NULL;')
    proof.update(offsite_verified=True, restore_verified=True, restore_database=name,
                 verified_at=int(time.time()))
    proof_path.write_text(json.dumps(proof))
    print('backup_restore=PASS;backup_id=' + backup_id + ';production_migration_run=no')


def write_json(path, value):
    with path.open('x') as output:
        os.chmod(path, 0o600)
        json.dump(value, output)
        output.flush()
        os.fsync(output.fileno())


def approval(proof, sha, digest, backup_id, now=None):
    now = int(time.time()) if now is None else now
    value = json.loads(private_file(CONFIG / 'migration-approval.json').read_text())
    require(value.get('sha') == sha and value.get('digest') == digest
            and value.get('backup_id') == backup_id and value.get('confirmation') == 'MIGRATE_INITIAL_HOTPOT'
            and value.get('ticket') and value.get('approved_by'), 'explicit_approval_missing')
    start, end = value.get('window_start', 0), value.get('window_end', 0)
    require(type(start) is int and type(end) is int and start <= now < end
            and 0 < end - start <= 3600, 'outside_approved_window')
    require(proof.get('sha') == sha and proof.get('offsite_verified') is True
            and proof.get('restore_verified') is True and proof.get('consumed') is False
            and 0 <= now - proof['created_at'] <= 7200, 'recent_backup_restore_required')
    return value


def workflow_authorize(sha, digest, run_id):
    """Owner's exact Issue #3 command is the approval; all DB evidence stays private.

    Called only by the pinned GitHub Action holding the existing SSH identity.
    This does not create a backup or waive independent Windows restore proof.
    """
    require(re.fullmatch(r'[0-9a-f]{40}', sha) and
            re.fullmatch(r'[0-9a-f]{64}', digest) and
            re.fullmatch(r'[0-9]{1,20}', run_id), 'invalid_workflow_request')
    now = int(time.time())
    offline_empty()
    release = release_module()
    files = frozen_source(sha, digest, release)
    require({name for name in files if name.endswith('/migration.sql')} == {
        'apps/api/prisma/migrations/' + name + '/migration.sql'
        for name in release.MIGRATIONS}, 'unreviewed_migration_source')
    require(not (CONFIG / 'migration-approval.json').exists(), 'existing_migration_approval')
    candidates = []
    for path in BACKUPS.glob('*.json'):
        if not re.fullmatch(r'[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}\.json', path.name):
            continue
        proof = json.loads(private_file(path).read_text())
        created = proof.get('created_at')
        if (proof.get('sha') == sha and proof.get('offsite_verified') is True and
            proof.get('restore_verified') is True and proof.get('consumed') is False and
            type(created) is int and 0 <= now - created <= 7200 and
            proof.get('fingerprint') == fingerprint('hotpot')):
            candidates.append((created, path.stem))
    require(bool(candidates), 'recent_verified_offsite_backup_missing')
    _, backup_id = max(candidates)
    write_json(CONFIG / 'migration-approval.json', {
        'sha': sha, 'digest': digest, 'backup_id': backup_id,
        'confirmation': 'MIGRATE_INITIAL_HOTPOT',
        'ticket': 'github-run-' + run_id, 'approved_by': 'github-owner-issue-3',
        'window_start': now, 'window_end': now + 1800,
    })
    print('workflow_authorization=PASS;backup_id=' + backup_id)


def migration(sha, digest, backup_id, apply=False):
    require(re.fullmatch(r'[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}', backup_id), 'invalid_backup_id')
    proof_path = private_file(BACKUPS / (backup_id + '.json'))
    proof = json.loads(proof_path.read_text())
    approved = approval(proof, sha, digest, backup_id)
    offline_empty()
    require(fingerprint('hotpot') == proof['fingerprint'], 'database_changed_since_backup')
    release = release_module()
    files = frozen_source(sha, digest, release)
    require({name for name in files if name.endswith('/migration.sql')} == {
        'apps/api/prisma/migrations/' + name + '/migration.sql' for name in release.MIGRATIONS},
        'only_reviewed_initial_migrations_allowed')
    if not apply:
        print('migration_preflight=PASS;production_migration_run=no')
        return
    # Approval is single-use even if installation/migration fails. No automatic retry/reset.
    os.rename(CONFIG / 'migration-approval.json', CONFIG / ('migration-approval.used-' + backup_id + '.json'))
    proof['consumed'] = True
    proof_path.write_text(json.dumps(proof))
    WORK.mkdir(mode=0o711, exist_ok=True)
    require(not WORK.is_symlink() and WORK.stat().st_uid == 0, 'unsafe_work_directory')
    # umask 077 reduces mkdir(0711) to 0700; the builder needs absolute-path traversal.
    os.chmod(WORK, 0o711)
    temporary = Path(tempfile.mkdtemp(prefix=sha + '-', dir=WORK))
    for name, data in files.items():
        target = temporary / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    call(['chown', '-R', 'hotpot-build:hotpot-build', str(temporary)])
    build_env = {'PATH': '/usr/bin:/bin', 'HOME': '/var/lib/sichuan-hotpot/build',
                 'npm_config_cache': '/var/lib/sichuan-hotpot/build/cache'}
    call(['/usr/sbin/runuser', '-u', 'hotpot-build', '--', '/usr/bin/npm', 'ci',
          '--workspace=apps/api', '--workspace=packages/shared', '--include-workspace-root',
          '--ignore-scripts', '--no-audit', '--no-fund'], env=build_env, cwd=temporary)
    # Download/prepare Prisma engines while the builder can still write modules.
    call(['/usr/sbin/runuser', '-u', 'hotpot-build', '--', '/usr/bin/node',
          str(temporary / 'node_modules/prisma/build/index.js'), 'generate', '--schema',
          str(temporary / 'apps/api/prisma/schema.prisma')],
         env=dict(build_env, DATABASE_URL='postgresql://unused:unused@127.0.0.1:5432/unused'), cwd=temporary)
    call(['chown', '-R', 'root:hotpot-build', str(temporary)])
    call(['chmod', '-R', 'g+rX,g-w,o-rwx', str(temporary)])
    # mkdtemp's 0700 would otherwise prevent the non-root executor reading source.
    os.chmod(temporary, 0o750)
    require(approved['window_start'] <= int(time.time()) < approved['window_end']
            and 0 <= int(time.time()) - proof['created_at'] <= 7200, 'approval_expired_during_preparation')
    offline_empty()
    require(fingerprint('hotpot') == proof['fingerprint'], 'database_changed_during_preparation')
    role = 'hotpot_migrate_' + secrets.token_hex(8)
    password = secrets.token_hex(32)
    expiry = time.strftime('%Y-%m-%d %H:%M:%S+00', time.gmtime(approved['window_end']))
    quiet_sql("BEGIN; CREATE ROLE " + role + " LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '" + password + "' VALID UNTIL '" + expiry + "'; GRANT hotpot_owner TO " + role + "; GRANT CONNECT ON DATABASE hotpot TO " + role + '; COMMIT;')
    try:
        env = dict(build_env, DATABASE_URL='postgresql://' + role + ':' + password
                   + '@127.0.0.1:5432/hotpot?schema=public&options=-c%20role%3Dhotpot_owner')
        base = ['/usr/sbin/runuser', '-u', 'hotpot-build', '--', '/usr/bin/node',
                str(temporary / 'node_modules/prisma/build/index.js'), 'migrate']
        schema = str(temporary / 'apps/api/prisma/schema.prisma')
        call(base + ['deploy', '--schema', schema], env=env, cwd=temporary)
        quiet_sql('REVOKE INSERT, UPDATE, DELETE ON public._prisma_migrations FROM hotpot_app;', 'hotpot')
        call(base + ['status', '--schema', schema], env=env, cwd=temporary)
        call(base + ['diff', '--from-schema-datasource', schema,
                     '--to-schema-datamodel', schema, '--exit-code'], env=env, cwd=temporary)
        require(release.db_schema_ready(release.environment()), 'post_migration_history_failed')
        require(quiet_sql('SELECT count(*) FROM public."User";', 'hotpot')[-1] == '0'
                and quiet_sql('SELECT count(*) FROM public."Order";', 'hotpot')[-1] == '0',
                'initial_data_reconciliation_failed')
        print('migration=PASS;schema_drift=PASS;reconciliation=PASS;api_service_unchanged=yes')
    finally:
        quiet_sql('ALTER ROLE ' + role + ' NOLOGIN PASSWORD NULL; REVOKE hotpot_owner FROM ' + role
                  + '; REVOKE CONNECT ON DATABASE hotpot FROM ' + role + ';')


def release_module():
    spec = importlib.util.spec_from_loader('release', SourceFileLoader('release', str(RELEASE_HELPER)))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def frozen_source(sha, digest, release):
    target = private_file(WORK / 'sources' / (sha + '.tgz'))
    data = target.read_bytes()
    require(hashlib.sha256(data).hexdigest() == digest, 'source_digest_mismatch')
    return release.archive_files(data)


def stage(sha, digest):
    target = INCOMING / ('hotpot-api-' + sha + '.tgz')
    fd = os.open(target, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as source:
        data = source.read(64 * 1024 * 1024 + 1)
    require(hashlib.sha256(data).hexdigest() == digest, 'source_digest_mismatch')
    release_module().archive_files(data)
    WORK.mkdir(mode=0o711, exist_ok=True)
    require(not WORK.is_symlink() and WORK.stat().st_uid == 0, 'unsafe_work_directory')
    os.chmod(WORK, 0o711)
    directory = WORK / 'sources'
    directory.mkdir(mode=0o700, exist_ok=True)
    destination = directory / (sha + '.tgz')
    with destination.open('xb') as output:
        os.chmod(destination, 0o600)
        output.write(data)
    print('migration_source_staged=PASS;digest=' + digest + ';production_migration_run=no')


def main(args):
    require(os.geteuid() == 0, 'root_required')
    os.umask(0o077)
    with open('/run/lock/hotpot-api-release.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args == ['--check-config']:
            settings()
            offline_empty()
            print('backup_configuration=PASS;production_migration_run=no')
            return
        if len(args) == 4 and args[0] == '--workflow-authorize':
            workflow_authorize(args[1], args[2], args[3])
            return
        if len(args) == 3 and args[0] == '--restore':
            restore(args[1], args[2])
            return
        if len(args) == 3 and args[0] == '--stage':
            require(re.fullmatch(r'[0-9a-f]{40}', args[1]) and re.fullmatch(r'[0-9a-f]{64}', args[2]), 'invalid_source')
            stage(args[1], args[2])
            return
        if len(args) == 2 and args[0] == '--source-digest':
            require(re.fullmatch(r'[0-9a-f]{40}', args[1]), 'invalid_sha')
            print(hashlib.sha256(private_file(WORK / 'sources' / (args[1] + '.tgz')).read_bytes()).hexdigest())
            return
        require(len(args) in (2, 4), 'invalid_arguments')
        mode, sha = args[:2]
        require(re.fullmatch(r'[0-9a-f]{40}', sha), 'invalid_sha')
        if mode == '--backup' and len(args) == 2:
            backup(sha)
        else:
            require(mode in ('--preflight', '--migrate') and len(args) == 4, 'invalid_arguments')
            require(re.fullmatch(r'[0-9a-f]{64}', args[2]), 'invalid_digest')
            migration(sha, args[2], args[3], apply=mode == '--migrate')


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except GateError as error:
        print('db_operation=BLOCKED;reason=' + error.args[0], file=sys.stderr)
        sys.exit(2)
    except Exception:
        print('db_operation=BLOCKED;reason=operation_failed', file=sys.stderr)
        sys.exit(2)
