"""Unit tests for keyless FCM relay config; no real VPS or Firebase calls."""
import importlib.util
from pathlib import Path
import unittest

path = Path(__file__).resolve().parents[1] / "hotpot-fcm-appscript-config.py"
spec = importlib.util.spec_from_file_location("relay_config", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ConfigTests(unittest.TestCase):
    def test_rejects_unsafe_addresses_and_weak_secrets(self):
        import json
        examples = [
            {"url": "http://script.google.com/macros/s/ABC/exec", "secret": "f" * 64},
            {"url": "https://evil.test/path", "secret": "f" * 64},
            {"url": "https://script.google.com/macros/s/ABC/exec", "secret": "unsafe"},
            {"url": "https://script.google.com/macros/s/ABC/exec", "secret": "c" * 64 + "\nE=1"},
        ]
        for value in examples:
            with self.assertRaises(module.Blocked):
                module.settings(json.dumps(value))

    def test_exact_google_url_and_preserve_unrelated_environment(self):
        import json
        update = module.settings(json.dumps({
            "url": "https://script.google.com/macros/s/AKfycb-test/exec",
            "secret": "a" * 64,
        }))
        content = "# header\nHOST=127.0.0.1\nPORT=3000\nDATABASE_URL=private\n"
        rewritten = module.render(content, update)
        self.assertIn("DATABASE_URL=private", rewritten)
        self.assertEqual(module.render(rewritten, update), rewritten)
        self.assertEqual(rewritten.count("FCM_RELAY_SECRET_HEX="), 1)

    def test_env_duplicates_rejected(self):
        with self.assertRaises(module.Blocked):
            module.read_env("FCM_RELAY_URL=x\nFCM_RELAY_URL=y\n")

    def test_public_url_does_not_allow_query_or_credentials(self):
        import json
        for suffix in ("?key=x", "#fragment", "/extra", "@evil.test"):
            obj = {"url": "https://script.google.com/macros/s/ABC/exec" + suffix,
                   "secret": "1" * 64}
            with self.assertRaises(module.Blocked):
                module.settings(json.dumps(obj))


if __name__ == "__main__":
    unittest.main()
