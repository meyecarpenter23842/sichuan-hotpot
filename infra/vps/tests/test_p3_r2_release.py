import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, mock_open

spec = importlib.util.spec_from_file_location("p3", Path(__file__).parents[1] / "hotpot-p3-operations.py")
p3 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p3)


class MigrationGuardTests(unittest.TestCase):
    def setUp(self):
        self.names = p3.PREVIOUS + p3.P3
        self.hashes = {name: "a" * 64 for name in self.names}

    def history(self, names):
        rows = "\n".join(name + "|" + self.hashes[name] + "|true|false" for name in names)
        with patch.object(p3, "sql", return_value=rows):
            return p3.checked_history(self.hashes)

    def test_approved_previous_and_all_p3_pending(self):
        self.assertEqual(self.history(p3.PREVIOUS), set(p3.PREVIOUS))

    def test_one_p3_migration_is_resumable(self):
        applied = self.history(p3.PREVIOUS + p3.P3[:1])
        self.assertEqual(applied.intersection(p3.P3), {p3.P3[0]})

    def test_missing_previous_migration_fails_closed(self):
        with self.assertRaises(p3.GateError):
            self.history(p3.PREVIOUS[:-1])

    def test_second_p3_cannot_precede_first(self):
        with self.assertRaises(p3.GateError):
            self.history(p3.PREVIOUS + p3.P3[1:])

    def test_unexpected_migration_fails_closed(self):
        rows = "\n".join(name + "|" + self.hashes[name] + "|true|false" for name in p3.PREVIOUS)
        with patch.object(p3, "sql", return_value=rows + "\nunknown|deadbeef|true|false"):
            with self.assertRaises(p3.GateError):
                p3.checked_history(self.hashes)

    def test_checksum_drift_and_failed_migration_rejected(self):
        for line in (p3.PREVIOUS[0] + "|badhash|true|false",
                     p3.PREVIOUS[0] + "|" + "a" * 64 + "|false|false"):
            rows = line + "\n" + "\n".join(n + "|" + "a" * 64 + "|true|false" for n in p3.PREVIOUS[1:])
            with self.subTest(line=line), patch.object(p3, "sql", return_value=rows):
                with self.assertRaises(p3.GateError):
                    p3.checked_history(self.hashes)

    def test_private_symlink_rejected(self):
        with tempfile.TemporaryDirectory() as t:
            path = Path(t) / "key"
            path.write_text("secret")
            symlink = Path(t) / "linked"
            symlink.symlink_to(path)
            with self.assertRaises(p3.GateError):
                p3.private_file(symlink)


class NeverMigrateWithoutRestoreTests(unittest.TestCase):
    def invoke(self, applied, failure=None):
        with (patch.object(p3.os, "geteuid", return_value=0),
              patch("builtins.open", mock_open()),
              patch.object(p3.fcntl, "flock"),
              patch.object(p3, "checked_source", return_value=({"file": b"bytes"}, {})),
              patch.object(p3, "checked_history", return_value=applied),
              patch.object(p3, "backup_config"),
              patch.object(p3, "backup_restore", side_effect=failure or (lambda sha: Path("/tmp/unused"))) as backup,
              patch.object(p3, "migrate") as migrate):
            if failure:
                with self.assertRaises(p3.GateError):
                    p3.main(["--release", "a" * 40, "b" * 64])
            else:
                p3.main(["--release", "a" * 40, "b" * 64])
            return backup.call_count, migrate.call_count

    def test_already_applied_does_not_rebackup_or_migrate(self):
        self.assertEqual(self.invoke(set(p3.PREVIOUS + p3.P3)), (0, 0))

    def test_remote_backup_or_isolated_restore_failure_cannot_mutate_db(self):
        self.assertEqual(self.invoke(set(p3.PREVIOUS),
                         p3.GateError("offsite_download_checksum_mismatch")), (1, 0))
        self.assertEqual(self.invoke(set(p3.PREVIOUS),
                         p3.GateError("isolated_restore_failed")), (1, 0))

    def test_invalid_arguments_cannot_enter_operations(self):
        with patch.object(p3.os, "geteuid", return_value=0):
            for args in ([], ["--release", "main", "bad"], ["--migrate", "a", "b"]):
                if len(args) == 3 and args[0] == "--release":
                    continue
                with self.assertRaises(p3.GateError):
                    p3.main(args)


if __name__ == "__main__":
    unittest.main()
