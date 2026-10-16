import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, mock_open

spec = importlib.util.spec_from_file_location("p42", Path(__file__).parents[1] / "hotpot-migrations-release.py")
p4 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p4)


class NeonDatabaseUrlTests(unittest.TestCase):
    def test_pooler_url_is_normalized_to_direct_neon_for_backup_and_migration(self):
        original = p4.CONFIG
        try:
            with tempfile.TemporaryDirectory() as d:
                p4.CONFIG = Path(d)
                (p4.CONFIG / "api.env").write_text(
                    "DATABASE_URL=postgresql://hotpot_owner:test%40secret@"
                    "ep-demo-pooler.c-6.us-east-2.aws.neon.tech/hotpot?sslmode=require\n"
                )
                url = p4.production_database_url()
                self.assertIn("@ep-demo.c-6.us-east-2.aws.neon.tech:5432/hotpot", url)
                self.assertNotIn("-pooler.", url)
                self.assertTrue(url.endswith("?sslmode=require"))
                env = p4.database_process_env()
                self.assertEqual(env["PGHOST"], "ep-demo.c-6.us-east-2.aws.neon.tech")
                self.assertEqual(env["PGPASSWORD"], "test@secret")
        finally:
            p4.CONFIG = original

    def test_non_neon_database_is_rejected(self):
        original = p4.CONFIG
        try:
            with tempfile.TemporaryDirectory() as d:
                p4.CONFIG = Path(d)
                (p4.CONFIG / "api.env").write_text(
                    "DATABASE_URL=postgresql://u:p@127.0.0.1:5432/hotpot\n"
                )
                with self.assertRaisesRegex(p4.GateError, "neon_database_configuration_required"):
                    p4.production_database_url()
        finally:
            p4.CONFIG = original


class LiveP4HistoryTests(unittest.TestCase):
    def setUp(self):
        self.migrations = ("20261012000000_init", "20261013000000_feature_a",
                           "20261014000000_feature_b", "20261015000000_feature_c")
        self.hashes = {name: "a" * 64 for name in self.migrations}

    def history(self, migrations):
        rows = "\n".join(name + "|" + self.hashes[name] + "|true|false" for name in migrations)
        with patch.object(p4, "sql", return_value=rows):
            return p4.checked_history(self.hashes)

    def test_migration_history_accepts_every_valid_prefix(self):
        for n in range(1, len(self.migrations) + 1):
            prefix = self.migrations[:n]
            self.assertEqual(self.history(prefix), set(prefix))

    def test_out_of_order_or_bad_checksum_rejected(self):
        with self.assertRaises(p4.GateError):
            self.history(())
        with self.assertRaises(p4.GateError):
            self.history(self.migrations[:1] + self.migrations[2:3])
        with self.assertRaises(p4.GateError):
            self.history(self.migrations[1:])
        with patch.object(p4, "sql", return_value=self.migrations[0] + "|b" * 1):
            with self.assertRaises(p4.GateError):
                p4.checked_history(self.hashes)

    def test_failed_or_unreviewed_migration_rejected(self):
        for value in ("not-reviewed|abc|true|false", self.migrations[0] + "|" + "a" * 64 + "|false|false"):
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
    def setUp(self):
        self.migrations = ("20261012000000_init", "20261013000000_feature_a",
                           "20261014000000_feature_b", "20261015000000_feature_c")

    def invoke(self, applied, failed_backup=None, mode="--release"):
        with tempfile.TemporaryDirectory() as directory:
            receipt = Path(directory) / "restore-receipt.json"
            receipt.write_text('{"consumed": false, "offsite_verified": true, "restore_verified": true}')
            with (patch.object(p4.os, "geteuid", return_value=0),
                  patch("builtins.open", mock_open()),
                  patch.object(p4.fcntl, "flock"),
                  patch.object(p4, "checked_source", return_value=({"mock": b"x"},
                      {name: "a" * 64 for name in self.migrations})),
                  patch.object(p4, "checked_history", return_value=applied),
                  patch.object(p4, "backup_config"),
                  patch.object(p4, "private_file", side_effect=lambda path: Path(path)),
                  patch.object(p4, "backup_restore",
                               side_effect=failed_backup or (lambda sha: receipt)) as backup,
                  patch.object(p4, "migrate") as migrate):
                if failed_backup:
                    with self.assertRaises(p4.GateError):
                        p4.main([mode, "a" * 40, "b" * 64])
                else:
                    p4.main([mode, "a" * 40, "b" * 64])
                if mode == "--release" and not failed_backup and backup.call_count:
                    import json
                    self.assertTrue(json.loads(receipt.read_text())["consumed"])
                return backup.call_count, migrate.call_count

    def test_already_applied_does_not_rebackup_or_migrate(self):
        self.assertEqual(self.invoke(set(self.migrations)), (0, 0))

    def test_pending_version_requires_backup_and_migration(self):
        # A pending migration needs a fresh backup even after older versions completed.
        self.assertEqual(self.invoke(set(self.migrations[:-1])), (1, 1))

    def test_check_only_never_writes(self):
        self.assertEqual(self.invoke(set(self.migrations[:1]), mode="--check"), (0, 0))

    def test_backup_or_isolated_restore_failure_blocks_migration(self):
        for reason in ("backup_encryption_failed", "offsite_download_checksum_mismatch",
                       "isolated_database_not_ready", "isolated_decrypt_failed",
                       "isolated_restore_permission", "isolated_restore_conflict",
                       "isolated_restore_compatibility", "isolated_restore_database_missing",
                       "isolated_restore_connection", "isolated_restore_query_failed",
                       "isolated_restore_failed"):
            self.assertEqual(self.invoke(set(self.migrations[:1]), p4.GateError(reason)), (1, 0))

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
                  patch.object(p4, "checked_source", return_value=({"mock": b"x"},
                      {name: "a" * 64 for name in self.migrations})),
                  patch.object(p4, "checked_history", return_value=set(self.migrations[:1])),
                  patch.object(p4, "backup_config"),
                  patch.object(p4, "backup_restore", return_value=receipt),
                  patch.object(p4, "private_file", side_effect=lambda x: Path(x)),
                  patch.object(p4, "migrate", side_effect=p4.GateError("post_commit_check_failed"))):
                with self.assertRaises(p4.GateError):
                    p4.main(["--release", "a" * 40, "b" * 64])
            import json
            self.assertTrue(json.loads(receipt.read_text())["consumed"])

    def test_live_migrator_never_uses_empty_database_helper(self):
        source = (Path(__file__).parents[1] / "hotpot-migrations-release.py").read_text()
        self.assertNotIn("offline_empty", source)
        self.assertNotIn("initial_empty_database_required", source)
        self.assertIn("business_data_reconciliation_failed", source)
        self.assertIn("isolated_restore(roundtrip)", source)
        self.assertNotIn("PREVIOUS =", source)
        self.assertNotIn("UPDATES =", source)
        self.assertIn("migration_history_incomplete", source)
        self.assertIn("production_database_url", source)
        self.assertNotIn('@127.0.0.1:5432/hotpot', source)
        self.assertNotIn('runuser", "-u", "postgres"', source)
        self.assertIn("wait_for_database(name)", source)
        self.assertIn("verify_decryption(cipher)", source)
        self.assertIn('"--clean", "--if-exists"', source)
        self.assertIn("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;", source)
        self.assertNotIn('"--single-transaction"', source)

    def test_restore_error_classification_is_sanitized(self):
        cases = {
            b"pg_restore: error: permission denied for schema public": "isolated_restore_permission",
            b"pg_restore: error: relation x already exists": "isolated_restore_conflict",
            b"ERROR: unrecognized configuration parameter foo": "isolated_restore_compatibility",
            b"FATAL: database x does not exist": "isolated_restore_database_missing",
            b"server closed the connection unexpectedly": "isolated_restore_connection",
            b"pg_restore: error: could not execute query": "isolated_restore_query_failed",
            b"other failure": "isolated_restore_failed",
        }
        for stderr, expected in cases.items():
            self.assertEqual(p4.restore_failure_reason(stderr), expected)

    def test_invalid_arguments_rejected(self):
        with patch.object(p4.os, "geteuid", return_value=0):
            for args in ([], ["--release", "main", "invalid"], ["--migrate", "a", "b"]):
                with self.assertRaises(p4.GateError):
                    p4.main(args)


if __name__ == "__main__":
    unittest.main()
