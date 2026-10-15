"""Real encrypted backup/restore + migration helper test on disposable CI PG only.

Never point this at a VPS. Fixed CI credential/loopback checks fail closed.
"""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
from unittest.mock import patch
import urllib.parse

url = urllib.parse.urlsplit(os.environ.get('DATABASE_URL', ''))
assert url.hostname == '127.0.0.1' and url.username == 'hotpot_ci'
assert url.path == '/hotpot_ci' and url.password == 'hotpot_ci_only'
assert os.environ.get('GITHUB_ACTIONS') == 'true' and os.geteuid() == 0
# Exercise the same restrictive umask used by the installed root helper.
os.umask(0o077)
root = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('db', root / 'infra/vps/hotpot-db-manual.py')
db = importlib.util.module_from_spec(spec)
spec.loader.exec_module(db)
original_call, original_pipe = db.call, db.pipe
admin_env = dict(os.environ, PGHOST='127.0.0.1', PGUSER=url.username, PGPASSWORD=url.password)


def adapt(command):
    if command[:5] == ['/usr/sbin/runuser', '-u', 'postgres', '--', '/usr/bin/psql'] or command[:5] == ['/usr/sbin/runuser', '-u', 'postgres', '--', '/usr/bin/pg_dump']:
        return command[4:]
    return command


def ci_call(command, data=None, env=None, **kwargs):
    command = adapt(command)
    if '/usr/bin/npm' in command or '/usr/bin/node' in command:
        command = [os.environ['CI_NPM_BIN'] if item == '/usr/bin/npm' else
                   os.environ['CI_NODE_BIN'] if item == '/usr/bin/node' else item for item in command]
        env = dict(env, PATH=str(Path(os.environ['CI_NODE_BIN']).parent) + ':' + env['PATH'])
    result = subprocess.run(command, input=data, env=env or admin_env, capture_output=True, timeout=600, **kwargs)
    if result.returncode:
        # Fixed error codes only, never command SQL/credentials or complete stderr.
        codes = sorted(set(re.findall(r'\b(?:P[0-9]{4}|EACCES|ENOENT|MODULE_NOT_FOUND)\b', result.stderr.decode(errors='replace'))))
        print('ci_command_error_codes=' + ','.join(codes), flush=True)
        raise db.GateError('ci_command_failed')
    return result.stdout


def ci_pipe(first, second, **kwargs):
    return original_pipe(adapt(first), second, env1=admin_env, **kwargs)


def ci_offline():
    # No systemd/production service in CI, retain the actual empty-schema gate.
    assert db.quiet_sql("SELECT count(*) FROM pg_tables WHERE schemaname='public';", 'hotpot')[-1] == '0'


with tempfile.TemporaryDirectory(prefix='hotpot-ci-drill-') as directory:
    base = Path(directory)
    os.chmod(base, 0o711)
    db.CONFIG, db.BACKUPS, db.WORK, db.INCOMING = (base / name for name in ('config', 'backups', 'work', 'incoming'))
    db.CONFIG.mkdir(mode=0o700)
    db.INCOMING.mkdir(mode=0o700)
    db.RELEASE_HELPER = root / 'infra/vps/hotpot-api-release-manual.py'
    subprocess.run(['useradd', '--system', '--user-group', '--shell', '/usr/sbin/nologin', 'hotpot-build'], check=True)
    home = Path('/var/lib/sichuan-hotpot/build')
    home.mkdir(parents=True, exist_ok=True)
    # Match the provisioned VPS parent: root owned, traversable, not listable.
    os.chmod(home.parent, 0o711)
    builder = pwd.getpwnam('hotpot-build')
    os.chown(home, builder.pw_uid, builder.pw_gid)
    identity = original_call(['/usr/bin/age-keygen'])
    identity_file = base / 'identity'
    identity_file.write_bytes(identity)
    os.chmod(identity_file, 0o600)
    recipient = original_call(['/usr/bin/age-keygen', '-y', str(identity_file)]).decode().strip()
    db.write_json(db.CONFIG / 'backup.json', {'age_recipient': recipient, 'offsite_mode': 'windows-pull'})
    with patch.object(db, 'call', ci_call), patch.object(db, 'pipe', ci_pipe), patch.object(db, 'offline_empty', ci_offline):
        db.quiet_sql("CREATE ROLE hotpot_owner NOLOGIN; CREATE ROLE hotpot_app LOGIN PASSWORD 'ci_app_only'; CREATE DATABASE hotpot OWNER hotpot_owner;")
        db.quiet_sql('REVOKE ALL ON DATABASE hotpot FROM PUBLIC; GRANT CONNECT ON DATABASE hotpot TO hotpot_app;')
        db.quiet_sql('GRANT USAGE ON SCHEMA public TO hotpot_app; ALTER DEFAULT PRIVILEGES FOR ROLE hotpot_owner IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO hotpot_app; ALTER DEFAULT PRIVILEGES FOR ROLE hotpot_owner IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO hotpot_app;', 'hotpot')
        lookup = pwd.getpwnam
        with patch.object(pwd, 'getpwnam', side_effect=lambda name: lookup('root' if name == 'ubuntu' else name)):
            db.backup('a' * 40)
        proof_path = next(db.BACKUPS.glob('*.json'))
        backup_id = proof_path.stem
        proof = json.loads(proof_path.read_text())
        encrypted = (db.BACKUPS / (backup_id + '.dump.age')).read_bytes()
        assert encrypted.startswith(b'age-encryption.org/v1')
        # Simulate a checksum-verified offsite filesystem then reimport those bytes.
        offsite = base / 'offsite'
        offsite.mkdir()
        copy = offsite / (backup_id + '.dump.age')
        copy.write_bytes(encrypted)
        assert hashlib.sha256(copy.read_bytes()).hexdigest() == proof['encrypted_sha256']
        (db.INCOMING / (backup_id + '.restore.age')).write_bytes(copy.read_bytes())
        with patch.object(sys, 'stdin', io.TextIOWrapper(io.BytesIO(identity))):
            db.restore(backup_id, proof['encrypted_sha256'])
        proof = json.loads(proof_path.read_text())
        assert proof['offsite_verified'] and proof['restore_verified']
        assert db.quiet_sql("SELECT rolcanlogin FROM pg_roles WHERE rolname='" + proof['restore_database'] + "';")[-1] == 'f'
        release = db.release_module()
        archive = db.INCOMING / ('hotpot-api-' + 'a' * 40 + '.tgz')
        with tarfile.open(archive, 'w:gz') as output:
            for name in sorted(release.REQUIRED):
                output.add(root / name, arcname=name, recursive=False)
            # Release manifest discovers reviewed SQL files from the archive.
            # Include all actual migrations; don't add a hardcoded allowlist.
            for sql_file in sorted((root / 'apps/api/prisma/migrations').glob('*/migration.sql')):
                output.add(sql_file, arcname=str(sql_file.relative_to(root)), recursive=False)
            output.add(root / 'packages/shared/dist', arcname='packages/shared/dist')
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        db.stage('a' * 40, digest)
        # Missing approval fails before any migration process or SQL DDL.
        try:
            db.migration('a' * 40, digest, backup_id, apply=True)
            raise AssertionError('unapproved migration executed')
        except FileNotFoundError:
            pass
        now = int(time.time())
        db.write_json(db.CONFIG / 'migration-approval.json', {'sha': 'a' * 40, 'digest': digest,
            'backup_id': backup_id, 'confirmation': 'MIGRATE_INITIAL_HOTPOT', 'ticket': 'disposable-ci',
            'approved_by': 'CI-test-only', 'window_start': now - 1, 'window_end': now + 1800})
        with patch.object(db, 'release_module', return_value=release), patch.object(release, 'environment', return_value={'DATABASE_URL': 'postgresql://hotpot_app:ci_app_only@127.0.0.1:5432/hotpot'}):
            db.migration('a' * 40, digest, backup_id, apply=False)
            db.migration('a' * 40, digest, backup_id, apply=True)
        assert json.loads(proof_path.read_text())['consumed']
        assert not (db.CONFIG / 'migration-approval.json').exists()
        assert db.quiet_sql("SELECT count(*) FROM pg_roles WHERE rolname LIKE 'hotpot_migrate_%' AND rolcanlogin;")[-1] == '0'
        assert db.quiet_sql("SELECT count(*) FROM pg_tables WHERE schemaname='public';", proof['restore_database'])[-1] == '0'
        assert release.db_schema_ready(
            {'DATABASE_URL': 'postgresql://hotpot_app:ci_app_only@127.0.0.1:5432/hotpot'},
            release.migration_names(release.archive_files(archive.read_bytes())))
        print('disposable_CI_encrypted_backup_restore_migration=PASS;production_touched=no')
