import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("release", Path(__file__).parents[1] / "hotpot-api-release-manual.py")
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


def archive(extra=None):
    buffer = io.BytesIO()
    files = {path: b"{}" for path in release.REQUIRED}
    files["apps/api/prisma/migrations/migration_lock.toml"] = b'provider = "postgresql"'
    files["apps/api/prisma/migrations/20261012000000_init/migration.sql"] = b"SELECT 1;"
    files["apps/api/package.json"] = json.dumps({"name": "@hotpot/api", "scripts": {"start": "node dist/main.js"}}).encode()
    with tarfile.open(fileobj=buffer, mode="w:gz") as output:
        for name, data in files.items():
            member = tarfile.TarInfo(name)
            member.size = len(data)
            output.addfile(member, io.BytesIO(data))
        if extra:
            output.addfile(extra, io.BytesIO(b""))
    return buffer.getvalue()


class MigrationManifestTests(unittest.TestCase):
    def test_reviewed_migration_allowlist_matches_committed_sql(self):
        # Every committed migration is accepted from the reviewed main artifact
        # without adding names to a Python constant.
        repo = Path(__file__).resolve().parents[3]
        migrations = repo / "apps/api/prisma/migrations"
        committed = {
            child.name for child in migrations.iterdir()
            if child.is_dir() and (child / "migration.sql").is_file()
        }
        files = {path: b"{}" for path in release.REQUIRED}
        files["apps/api/prisma/migrations/migration_lock.toml"] = b'provider = "postgresql"'
        for name in committed:
            files["apps/api/prisma/migrations/" + name + "/migration.sql"] = b"SELECT 1;"
        self.assertEqual(set(release.migration_names(files)), committed)
        files["apps/api/prisma/migrations/20270101000000_new_feature/migration.sql"] = b"SELECT 1;"
        self.assertIn("20270101000000_new_feature", release.migration_names(files))


class DatabaseConfigurationTests(unittest.TestCase):
    def test_neon_pooler_is_accepted_and_direct_host_can_be_derived(self):
        env = {
            "DATABASE_URL": (
                "postgresql://hotpot_owner:test%40secret@"
                "ep-test-pooler.c-6.us-east-2.aws.neon.tech/hotpot?sslmode=require"
            )
        }
        self.assertEqual(release.database_parts(env).hostname,
                         "ep-test-pooler.c-6.us-east-2.aws.neon.tech")
        child = release.database_process_env(env, direct=True)
        self.assertEqual(child["PGHOST"], "ep-test.c-6.us-east-2.aws.neon.tech")
        self.assertEqual(child["PGDATABASE"], "hotpot")
        self.assertEqual(child["PGPASSWORD"], "test@secret")
        self.assertEqual(child["PGSSLMODE"], "require")

    def test_unknown_remote_database_host_is_rejected(self):
        env = {
            "DATABASE_URL": "postgresql://u:p@db.example.com:5432/hotpot?sslmode=require"
        }
        with self.assertRaisesRegex(release.ReleaseError, "unsafe_database_configuration"):
            release.database_parts(env)


class SilentBuildSafetyTests(unittest.TestCase):
    def test_preparation_has_bounded_sanitized_stages(self):
        source = (Path(__file__).parents[1] / "hotpot-api-release-manual.py").read_text()
        for stage in ("npm_install", "prisma_generate", "npm_prune", "runtime_imports"):
            self.assertIn('build_run("' + stage + '"', source)
        self.assertIn('runtime_build_step=', source)
        self.assertIn('subprocess.TimeoutExpired', source)
        self.assertIn('stdout=subprocess.DEVNULL', source)
        self.assertIn('stderr=subprocess.DEVNULL', source)


class ArchiveTests(unittest.TestCase):
    def test_accepts_expected_runtime_only(self):
        self.assertEqual(set(release.archive_files(archive())),
                         release.REQUIRED | {"apps/api/prisma/migrations/20261012000000_init/migration.sql"})

    def test_rejects_traversal_absolute_secret_dependency_and_duplicate(self):
        for name in ("../outside", "/outside", "apps/api/.env", "node_modules/code.js", "package.json"):
            with self.subTest(name=name), self.assertRaises(release.ReleaseError):
                release.archive_files(archive(tarfile.TarInfo(name)))

    def test_rejects_symlinks_hardlinks_and_devices(self):
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.CHRTYPE):
            member = tarfile.TarInfo("apps/api/dist/unsafe.js")
            member.type = kind
            member.linkname = "/outside"
            with self.subTest(kind=kind), self.assertRaises(release.ReleaseError):
                release.archive_files(archive(member))

    def test_requires_complete_artifact(self):
        data = io.BytesIO()
        with tarfile.open(fileobj=data, mode="w:gz"):
            pass
        with self.assertRaises(release.ReleaseError):
            release.archive_files(data.getvalue())

    def test_rejects_invalid_sha(self):
        for value in ("main", "a" * 39, "A" * 40, "a" * 40 + ";command"):
            with self.subTest(value=value), self.assertRaises(release.ReleaseError):
                release.valid_sha(value)


class ExistingReleaseRetryTests(unittest.TestCase):
    def test_same_sha_with_new_archive_digest_reuses_only_identical_source_payload(self):
        original_root = release.ROOT
        try:
            with tempfile.TemporaryDirectory() as directory:
                release.ROOT = Path(directory)
                sha = "a" * 40
                target = release.ROOT / "releases" / sha
                target.mkdir(parents=True)
                files = {
                    "package.json": b'{"name":"same-source"}',
                    "apps/api/dist/main.js": b"console.log('same');",
                }
                for name, data in files.items():
                    path = target / name
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(data)
                (target / "release.json").write_text(json.dumps({
                    "sha": sha, "digest": "1" * 64,
                }))
                self.assertEqual(
                    release.prepare(sha, "2" * 64, files), target,
                    "same reviewed source may resume after a nondeterministic archive retry",
                )
                (target / "apps/api/dist/main.js").write_bytes(b"changed")
                with self.assertRaisesRegex(release.ReleaseError, "existing_release_mismatch"):
                    release.prepare(sha, "3" * 64, files)
        finally:
            release.ROOT = original_root

    def test_existing_release_rejects_symlinked_source_even_when_bytes_match(self):
        original_root = release.ROOT
        try:
            with tempfile.TemporaryDirectory() as directory:
                release.ROOT = Path(directory)
                sha = "b" * 40
                target = release.ROOT / "releases" / sha
                target.mkdir(parents=True)
                real = release.ROOT / "real-package.json"
                real.write_bytes(b"{}")
                (target / "package.json").symlink_to(real)
                (target / "release.json").write_text(json.dumps({
                    "sha": sha, "digest": "1" * 64,
                }))
                with self.assertRaisesRegex(release.ReleaseError, "existing_release_mismatch"):
                    release.prepare(sha, "2" * 64, {"package.json": b"{}"})
        finally:
            release.ROOT = original_root


class RollbackTests(unittest.TestCase):
    def test_unhealthy_release_restores_previous_pointer_and_checks_health(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            previous = root / "old"
            target = root / "new"
            previous.mkdir()
            target.mkdir()
            current = root / "current"
            current.symlink_to(previous)
            events = []
            checks = iter([False, True])
            with self.assertRaisesRegex(release.ReleaseError, "release_failed_rolled_back"):
                release.activate(current, target, lambda: events.append("restart"),
                                 lambda: events.append("stop"), lambda: next(checks))
            self.assertEqual(current.resolve(), previous)
            self.assertEqual(events, ["restart", "restart"])

    def test_failed_first_release_stops_only_its_service_and_removes_pointer(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "new"
            target.mkdir()
            current = root / "current"
            events = []
            with self.assertRaises(release.ReleaseError):
                release.activate(current, target, lambda: events.append("restart"),
                                 lambda: events.append("stop"), lambda: False)
            self.assertFalse(current.is_symlink())
            self.assertTrue(target.is_dir())
            self.assertEqual(events, ["restart", "stop"])

    def test_healthy_release_switches_without_stopping(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "new"
            target.mkdir()
            current = root / "current"
            events = []
            release.activate(current, target, lambda: events.append("restart"),
                             lambda: events.append("stop"), lambda: True)
            self.assertEqual(current.resolve(), target)
            self.assertEqual(events, ["restart"])


if __name__ == "__main__":
    unittest.main()
