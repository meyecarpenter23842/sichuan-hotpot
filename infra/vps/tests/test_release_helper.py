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
    files["apps/api/package.json"] = json.dumps({"name": "@hotpot/api", "scripts": {"start": "node dist/main.js"}}).encode()
    with tarfile.open(fileobj=buffer, mode="w:gz") as output:
        for name, data in files.items():
            member = tarfile.TarInfo(name)
            member.size = len(data)
            output.addfile(member, io.BytesIO(data))
        if extra:
            output.addfile(extra, io.BytesIO(b""))
    return buffer.getvalue()


class ArchiveTests(unittest.TestCase):
    def test_accepts_expected_runtime_only(self):
        self.assertEqual(set(release.archive_files(archive())), release.REQUIRED)

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
