import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('db', Path(__file__).parents[1] / 'hotpot-db-manual.py')
db = importlib.util.module_from_spec(spec)
spec.loader.exec_module(db)


class ApprovalTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.config = Path(self.directory.name)
        self.value = {'sha': 'a' * 40, 'digest': 'b' * 64, 'backup_id': 'backup',
                      'confirmation': 'MIGRATE_INITIAL_HOTPOT', 'ticket': 'owner-approved',
                      'approved_by': 'owner', 'window_start': 1000, 'window_end': 2000}
        self.proof = {'sha': 'a' * 40, 'created_at': 1000, 'offsite_verified': True,
                      'restore_verified': True, 'consumed': False}
        self.path = self.config / 'migration-approval.json'
        self.config_patch = patch.object(db, 'CONFIG', self.config)
        self.config_patch.start()
        self.addCleanup(self.config_patch.stop)
        # Root-owned validation is tested separately; CI unit tests run unprivileged.
        self.private_patch = patch.object(db, 'private_file', side_effect=lambda path: Path(path))
        self.private_patch.start()
        self.addCleanup(self.private_patch.stop)

    def check(self):
        self.path.write_text(json.dumps(self.value))
        return db.approval(self.proof, 'a' * 40, 'b' * 64, 'backup', now=1500)

    def test_valid_separate_approval(self):
        self.assertEqual(self.check()['approved_by'], 'owner')

    def test_exact_sha_digest_and_backup_required(self):
        for field in ('sha', 'digest', 'backup_id', 'confirmation', 'ticket', 'approved_by'):
            previous = self.value[field]
            self.value[field] = ''
            with self.subTest(field=field), self.assertRaises(db.GateError):
                self.check()
            self.value[field] = previous

    def test_windows_expired_future_and_overlong(self):
        for start, end in ((0, 1000), (1600, 2000), (1000, 5000)):
            self.value.update(window_start=start, window_end=end)
            with self.subTest(start=start), self.assertRaises(db.GateError):
                self.check()

    def test_offsite_restore_and_single_use_required(self):
        for field in ('offsite_verified', 'restore_verified', 'consumed'):
            self.proof[field] = not self.proof[field]
            with self.subTest(field=field), self.assertRaises(db.GateError):
                self.check()
            self.proof[field] = not self.proof[field]

    def test_stale_and_future_backup_rejected(self):
        for timestamp in (-6000, 1600):
            self.proof['created_at'] = timestamp
            with self.assertRaises(db.GateError):
                self.check()

    def test_missing_approval_cannot_reach_sql(self):
        with patch.object(db, 'pg') as pg, self.assertRaises(FileNotFoundError):
            db.approval(self.proof, 'a' * 40, 'b' * 64, 'backup', now=1500)
        pg.assert_not_called()


class IsolationTests(unittest.TestCase):
    def test_restore_id_cannot_target_production_or_shell(self):
        for name in ('hotpot', '../hotpot', 'backup;command'):
            with self.subTest(name=name), self.assertRaises(db.GateError), patch.object(db, 'pg') as pg:
                db.restore(name, 'b' * 64)
            pg.assert_not_called()

    def test_symlink_private_config_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'real'
            path.write_text('{}')
            link = Path(directory) / 'link'
            link.symlink_to(path)
            with self.assertRaises(db.GateError):
                db.private_file(link)


class WorkflowCommandTests(unittest.TestCase):
    """Single owner comment must never authorize SQL without prior restore proof."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        root = Path(self.dir.name)
        self.backups = root / 'backups'
        self.backups.mkdir()
        self.config = root / 'config'
        self.config.mkdir()
        for attr, value in (('BACKUPS', self.backups), ('CONFIG', self.config)):
            patcher = patch.object(db, attr, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        private = patch.object(db, 'private_file', side_effect=lambda path: Path(path))
        private.start()
        self.addCleanup(private.stop)
        self.sha, self.digest = 'a' * 40, 'b' * 64
        self.backup_id = '20261012T120000Z-1234abcd'
        self.clock = patch.object(db.time, 'time', return_value=1000)
        self.clock.start()
        self.addCleanup(self.clock.stop)

    def authorize(self):
        expected = {'apps/api/prisma/migrations/' + name + '/migration.sql'
                    for name in ('20261012000000_init', '20261012010000_auth_identity')}
        with patch.object(db, 'offline_empty'), patch.object(db, 'release_module') as release, \\
             patch.object(db, 'frozen_source', return_value={name: b'-- SQL' for name in expected}), \\
             patch.object(db, 'fingerprint', return_value='fingerprint'):
            release.return_value.MIGRATIONS = ('20261012000000_init', '20261012010000_auth_identity')
            db.workflow_authorize(self.sha, self.digest, '123456')

    def proof(self, **changes):
        value = {'sha': self.sha, 'created_at': 900, 'offsite_verified': True,
                 'restore_verified': True, 'consumed': False, 'fingerprint': 'fingerprint'}
        value.update(changes)
        (self.backups / (self.backup_id + '.json')).write_text(json.dumps(value))

    def test_one_command_requires_actual_offsite_restore(self):
        with self.assertRaises(db.GateError):
            self.authorize()
        for change in ({'offsite_verified': False}, {'restore_verified': False},
                       {'sha': 'c' * 40}, {'created_at': -8000}):
            (self.backups / (self.backup_id + '.json')).unlink(missing_ok=True)
            self.proof(**change)
            with self.subTest(change=change), self.assertRaises(db.GateError):
                self.authorize()
        self.assertFalse((self.config / 'migration-approval.json').exists())

    def test_single_owner_command_creates_exact_single_use_approval(self):
        self.proof()
        self.authorize()
        record = json.loads((self.config / 'migration-approval.json').read_text())
        self.assertEqual(record['sha'], self.sha)
        self.assertEqual(record['digest'], self.digest)
        self.assertEqual(record['backup_id'], self.backup_id)
        self.assertEqual(record['approved_by'], 'github-owner-issue-3')
        self.assertEqual(record['ticket'], 'github-run-123456')
        with self.assertRaises(db.GateError):
            self.authorize()

    def test_invalid_workflow_request_does_not_authorize(self):
        self.proof()
        for sha, digest, run_id in (('bad', self.digest, '123'),
                                    (self.sha, 'bad', '123'),
                                    (self.sha, self.digest, 'shell; injection')):
            with self.subTest(run_id=run_id), self.assertRaises(db.GateError):
                db.workflow_authorize(sha, digest, run_id)
        self.assertFalse((self.config / 'migration-approval.json').exists())


if __name__ == '__main__':
    unittest.main()
