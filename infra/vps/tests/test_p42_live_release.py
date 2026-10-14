import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, mock_open

spec = importlib.util.spec_from_file_location("p42", Path(__file__).parents[1] / "hotpot-p42-operations.py")
p4 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p4)


class LiveP4HistoryTests(unittest.TestCase):
    def setUp(self):
        self.migrations = p4.PREVIOUS + p4.P4
        self.hashes = {name: "a" * 64 for name in self.migrations}

    def history(self, migrations):
        rows = "\n".join(name + "|" + self.hashes[name] + "|true|false" for name in migrations)
        with patch.object(p4, "sql", return_value=rows):
            return p4.checked_history(self.hashes)

    def test_p42_accepts_existing_p4_history_and_existing_live_db(self):
        self.assertEqual(self.history(p4.PREVIOUS), set(p4.PREVIOUS))
        self.assertEqual(self.history(p4.PREVIOUS + (p4.P4[0],)), set(p4.PREVIOUS + (p4.P4[0],)))
        self.assertEqual(self.history(self.migrations), set(self.migrations))

    def test_p42_out_of_order_or_bad_checksum_rejected(self):
        with self.assertRaises(p4.GateError):
            self.history(p4.PREVIOUS + (p4.P4[1],))
        with self.assertRaises(p4.GateError):
            self.history(p4.PREVIOUS[:-1])
        with patch.object(p4, "sql", return_value=p4.PREVIOUS[0] + "|b" * 1):
            with self.assertRaises(p4.GateError):
                p4.checked_history(self.hashes)

    def test_failed_or_unreviewed_migration_rejected(self):
        for value in ("not-reviewed|abc|true|false", p4.PREVIOUS[0] + "|" + "a" * 64 + "|false|false"):
            with patch.object(p4, "sql", return_value=value):
                with self.assertRaises(p4.GateError):
                    p4.checked_history(self.hashes)

    def test_private_symlink_rejected(self):
        with tempfile.TemporaryDirectory() as t:
            path = Path(t) / "key"
            path.write_bytes(b"not-a-real-key")
            link = Path(t) / "link"
            link.symlink_to(path)
            with self.assertRaises(p4.GateError):
                p4.private_file(link)


class LiveP4SafetyTests(unittest.TestCase):
    def invoke(self, applied, failed_backup=None, mode="--release"):
        with (patch.object(p4.os, "geteuid", return_value=0),
              patch("builtins.open", mock_open()),
              patch.object(p4.fcntl, "flock"),
              patch.object(p4, "checked_source", return_value=({"mock": b"x"}, {})),
              patch.object(p4, "checked_history", return_value=applied),
              patch.object(p4, "backup_config"),
              patch.object(p4, "backup_restore", side_effect=failed_backup or (lambda sha: Path("/tmp/mock"))) as backup,
              patch.object(p4, "migrate") as migrate):
            if failed_backup:
                with self.assertRaises(p4.GateError):
                    p4.main([mode, "a" * 40, "b" * 64])
            else:
                p4.main([mode, "a" * 40, "b" * 64])
            return backup.call_count, migrate.call_count

    def test_already_applied_does_not_rebackup_or_migrate(self):
        self.assertEqual(self.invoke(set(p4.PREVIOUS + p4.P4)), (0, 0))

    def test_check_only_never_writes(self):
        self.assertEqual(self.invoke(set(p4.PREVIOUS), mode="--check"), (0, 0))

    def test_backup_or_isolated_restore_failure_blocks_migration(self):
        for reason in ("backup_encryption_failed", "offsite_download_checksum_mismatch",
                       "isolated_restore_failed"):
            self.assertEqual(self.invoke(set(p4.PREVIOUS), p4.GateError(reason)), (1, 0))

    def test_checksum_streams_large_encrypted_backups(self):
        import hashlib
        with tempfile.TemporaryDirectory() as d:
            source = Path(d) / "encrypted.dump.age"
            data = b"private-encrypted-test-bytes" * 140000
            source.write_bytes(data)
            self.assertEqual(p4.sha256_file(source), hashlib.sha256(data).hexdigest())

    def test_migration_failure_cannot_reuse_backup_receipt(self):
        with tempfile.TemporaryDirectory() as d:
            receipt = Path(d) / "proof.json"
            receipt.write_text('{"consumed": false, "offsite_verified": true, "restore_verified": true}')
            with (patch.object(p4.os, "geteuid", return_value=0),
                  patch("builtins.open", mock_open()),
                  patch.object(p4.fcntl, "flock"),
                  patch.object(p4, "checked_source", return_value=({"mock": b"x"}, {})),
                  patch.object(p4, "checked_history", return_value=set(p4.PREVIOUS)),
                  patch.object(p4, "backup_config"),
                  patch.object(p4, "backup_restore", return_value=receipt),
                  patch.object(p4, "private_file", side_effect=lambda x: Path(x)),
                  patch.object(p4, "migrate", side_effect=p4.GateError("post_commit_check_failed"))):
                with self.assertRaises(p4.GateError):
                    p4.main(["--release", "a" * 40, "b" * 64])
            import json
            self.assertTrue(json.loads(receipt.read_text())["consumed"])

    def test_live_p42_never_uses_empty_database_helper(self):
        source = (Path(__file__).parents[1] / "hotpot-p42-operations.py").read_text()
        self.assertNotIn("offline_empty", source)
        self.assertNotIn("initial_empty_database_required", source)
        self.assertIn("business_data_reconciliation_failed", source)
        self.assertIn("isolated_restore(roundtrip)", source)
        self.assertIn("branch_address_missing", source)
        self.assertIn("20261014010000_p42_branch_address", source)

    def test_invalid_arguments_rejected(self):
        with patch.object(p4.os, "geteuid", return_value=0):
            for args in ([], ["--release", "main", "invalid"], ["--migrate", "a", "b"]):
                with self.assertRaises(p4.GateError):
                    p4.main(args)


if __name__ == "__main__":
    unittest.main()
