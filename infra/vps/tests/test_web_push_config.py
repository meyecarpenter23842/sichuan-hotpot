import importlib.util
from pathlib import Path
import unittest

MODULE_PATH = Path(__file__).resolve().parents[1] / "hotpot-web-push-config.py"
SPEC = importlib.util.spec_from_file_location("hotpot_web_push_config", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class WebPushConfigTest(unittest.TestCase):
    def test_replace_preserves_other_environment_values(self):
        original = "HOST=127.0.0.1\nPORT=3000\n# note\n"
        updated = MODULE.replace_env_text(original, {
            "WEB_PUSH_VAPID_PUBLIC_KEY": "A" * 87,
            "WEB_PUSH_VAPID_PRIVATE_KEY": "B" * 43,
            "WEB_PUSH_VAPID_SUBJECT": "https://bepsi.click",
        })
        values = MODULE.parse_env_text(updated)
        self.assertEqual(values["HOST"], "127.0.0.1")
        self.assertEqual(values["PORT"], "3000")
        self.assertEqual(values["WEB_PUSH_VAPID_SUBJECT"], "https://bepsi.click")
        self.assertEqual(updated.count("WEB_PUSH_VAPID_PUBLIC_KEY="), 1)

    def test_existing_keys_are_replaced_without_duplicates(self):
        original = (
            "WEB_PUSH_VAPID_PUBLIC_KEY=old\n"
            "WEB_PUSH_VAPID_PRIVATE_KEY=old\n"
            "WEB_PUSH_VAPID_SUBJECT=https://old.example\n"
        )
        updated = MODULE.replace_env_text(original, {
            "WEB_PUSH_VAPID_PUBLIC_KEY": "A" * 87,
            "WEB_PUSH_VAPID_PRIVATE_KEY": "B" * 43,
            "WEB_PUSH_VAPID_SUBJECT": "https://bepsi.click",
        })
        values = MODULE.parse_env_text(updated)
        self.assertEqual(values["WEB_PUSH_VAPID_PUBLIC_KEY"], "A" * 87)
        self.assertEqual(values["WEB_PUSH_VAPID_PRIVATE_KEY"], "B" * 43)
        self.assertEqual(updated.count("WEB_PUSH_VAPID_PRIVATE_KEY="), 1)

    def test_key_and_subject_validation(self):
        self.assertTrue(MODULE.keypair_valid("A" * 87, "B" * 43))
        self.assertFalse(MODULE.keypair_valid("bad key", "B" * 43))
        self.assertTrue(MODULE.subject_valid("https://bepsi.click"))
        self.assertTrue(MODULE.subject_valid("mailto:owner@example.com"))
        self.assertFalse(MODULE.subject_valid("http://bepsi.click"))


if __name__ == "__main__":
    unittest.main()
