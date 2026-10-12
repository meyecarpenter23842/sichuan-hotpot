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


if __name__ == '__main__':
    unittest.main()
