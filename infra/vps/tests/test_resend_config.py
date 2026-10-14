"""Secret-free tests for the Resend VPS-only setup helper."""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("resend_config", ROOT / "hotpot-resend-config.py")
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
FAKE_KEY = "re_" + "a" * 32


class ResendVpsSetupTests(unittest.TestCase):
    def test_preserves_other_secrets_and_uses_verified_sender(self):
        previous = (b"AUTH_JWT_SECRET=not-a-real-secret\n"
                    b"CORS_ALLOWED_ORIGINS=https://admin.bepsi.click\n")
        updated, changed = helper.rewrite_content(previous, FAKE_KEY)
        self.assertTrue(changed)
        self.assertTrue(updated.startswith(previous))
        self.assertIn(b"RESEND_API_KEY=" + FAKE_KEY.encode() + b"\n", updated)
        self.assertIn(b"HOTPOT_MAIL_FROM=noreply@bepsi.click\n", updated)
        self.assertEqual(helper.rewrite_content(updated, FAKE_KEY), (updated, False))

    def test_updates_existing_keys_without_touching_other_values(self):
        before = (b"RESEND_API_KEY=re_" + b"x" * 30 + b"\r\n"
                  b"KEEP_ME=unchanged\r\n"
                  b"HOTPOT_MAIL_FROM=old@example.test\r\n")
        updated, changed = helper.rewrite_content(before, FAKE_KEY)
        self.assertTrue(changed)
        self.assertEqual(updated.count(b"RESEND_API_KEY="), 1)
        self.assertEqual(updated.count(b"HOTPOT_MAIL_FROM="), 1)
        self.assertIn(b"KEEP_ME=unchanged\r\n", updated)
        self.assertEqual(updated.count(b"\n"), updated.count(b"\r\n"))
        self.assertEqual(helper.rewrite_content(updated, FAKE_KEY), (updated, False))

    def test_rejects_duplicates_and_malformed_input(self):
        for before in (
            b"RESEND_API_KEY=old\nRESEND_API_KEY=duplicate\n",
            b"HOTPOT_MAIL_FROM=one\nHOTPOT_MAIL_FROM=two\n",
            b"UNRELATED=ok\x00TRAIL=bad\n",
        ):
            with self.subTest(before=before[:16]), self.assertRaises(helper.Blocked):
                helper.rewrite_content(before, FAKE_KEY)
        for key in ("", "Bearer token", "re_short", "re_" + "a" * 151,
                    "re_" + "x" * 30 + "\nINJECTION=1"):
            with self.subTest(value_len=len(key)), self.assertRaises(helper.Blocked):
                helper.rewrite_content(b"SAFE=1\n", key)

    def test_password_never_enters_source_control_or_shell_arguments(self):
        ps = (ROOT.parents[1] / "scripts/ops/set-resend-config.ps1").read_text()
        py = (ROOT / "hotpot-resend-config.py").read_text()
        self.assertIn("Read-Host 'Resend API key' -AsSecureString", ps)
        self.assertIn("$taskProcess.StandardInput.WriteLine($taskValue)", ps)
        self.assertIn("StrictHostKeyChecking=yes", ps)
        self.assertIn("sys.stdin.buffer.readline()", ps)
        self.assertIn("atomic_replace(API_ENV, previous, st)", py)
        self.assertIn('["/usr/bin/systemctl", "restart", SERVICE]', py)
        self.assertNotIn("Write-Host $taskValue", ps)
        self.assertNotIn("RESEND_API_KEY=$", ps)


if __name__ == "__main__":
    unittest.main()
