import importlib.util
import unittest
from pathlib import Path
from urllib.parse import urlsplit, parse_qs

source = Path(__file__).resolve().parents[1] / "hotpot-services-configure.py"
spec = importlib.util.spec_from_file_location("hotpot_services_configure", source)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def valid():
    return {
        "R2_ACCOUNT_ID": "bae4e0be81d8f56be5b75402ccd3bb9b",
        "R2_ACCESS_KEY_ID": "dummyaccesskey1234567890",
        "R2_SECRET_ACCESS_KEY": "dummy_secret_1234567890_testing_only",
        "R2_BUCKET": "hot-pot",
    }


class HotpotServicesConfigTests(unittest.TestCase):
    def test_validates_only_exact_values_and_never_echoes_secrets(self):
        settings = valid()
        self.assertEqual(mod.validate(settings), settings)
        for key in settings:
            broken = dict(settings)
            broken[key] = ""
            with self.subTest(key=key), self.assertRaises(ValueError):
                mod.validate(broken)
        broken = dict(settings)
        broken["R2_SECRET_ACCESS_KEY"] += "\nINJECTED=1"
        with self.assertRaises(ValueError):
            mod.validate(broken)
        broken = dict(settings)
        broken["R2_BUCKET"] = "hotpot-db-backups-private"
        with self.assertRaises(ValueError):
            mod.validate(broken)

    def test_env_update_keeps_existing_identity_and_is_idempotent(self):
        prev = [
            "# Keep all existing backend settings unchanged",
            "HOST=127.0.0.1", "PORT=3000",
            "DATABASE_URL=postgresql://test-only@localhost:5432/test",
            "AUTH_JWT_SECRET=not-a-real-secret",
            "R2_BUCKET=hot-pot", "R2_ACCESS_KEY_ID=expired-demo",
        ]
        after = mod.render_env(prev, valid())
        result = mod.parse_env(after.splitlines())
        self.assertEqual(result["R2_ACCESS_KEY_ID"], valid()["R2_ACCESS_KEY_ID"])
        self.assertEqual(result["DATABASE_URL"], "postgresql://test-only@localhost:5432/test")
        self.assertEqual(after, mod.render_env(after.splitlines(), valid()))
        self.assertEqual(sum(line.startswith("R2_BUCKET=") for line in after.splitlines()), 1)
        self.assertEqual(sum(line.startswith("R2_ACCESS_KEY_ID=") for line in after.splitlines()), 1)

    def test_fails_closed_on_duplicate_existing_vars(self):
        with self.assertRaisesRegex(ValueError, "invalid_existing_environment"):
            mod.render_env(["PORT=3000", "PORT=3001"], valid())
        with self.assertRaisesRegex(ValueError, "invalid_existing_environment"):
            mod.render_env(["INVALID-CONTROL=value"], valid())

    def test_presigned_url_never_contains_secrets_and_is_method_specific(self):
        settings = valid()
        import datetime as dt
        at = dt.datetime(2026, 10, 15, 10, 0, tzinfo=dt.timezone.utc)
        key = "products-image/_bootstrap-check/test-file.png"
        put = mod.presign(settings, "PUT", key, at)
        head = mod.presign(settings, "HEAD", key, at)
        self.assertNotEqual(put, head)
        self.assertTrue(put.startswith("https://bae4e0be81d8f56be5b75402ccd3bb9b.r2.cloudflarestorage.com/hot-pot/products-image/"))
        self.assertNotIn(settings["R2_SECRET_ACCESS_KEY"], put)
        parts = urlsplit(put)
        q = parse_qs(parts.query)
        self.assertEqual(q["X-Amz-Expires"], ["120"])
        self.assertEqual(q["X-Amz-SignedHeaders"], ["host"])
        self.assertEqual(len(q["X-Amz-Signature"][0]), 64)

    def test_png_probe_payload_is_small_and_has_png_magic(self):
        self.assertTrue(mod.PNG_1PX.startswith(b"\x89PNG\r\n\x1a\n"))
        self.assertLess(len(mod.PNG_1PX), 1024)


if __name__ == "__main__":
    unittest.main()
