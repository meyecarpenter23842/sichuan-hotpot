import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("admin_cors", ROOT / "hotpot-admin-cors.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class NarrowCORSChangeTests(unittest.TestCase):
    def test_preserves_unrelated_environment_and_customer_origin(self):
        before = (b"# production\nAPI_TEST_SECRET=do-not-print\n"
                  b"CORS_ALLOWED_ORIGINS=https://sichuan-hotpot-customer.vercel.app\n"
                  b"OTHER=unchanged\n")
        result, changed = module.rewrite_content(before)
        self.assertTrue(changed)
        self.assertIn(b"API_TEST_SECRET=do-not-print\n", result)
        self.assertIn(b"OTHER=unchanged\n", result)
        self.assertIn(module.CUSTOMER.encode(), result)
        self.assertIn(module.ADMIN.encode(), result)
        self.assertIn(module.ADMIN_CUSTOM.encode(), result)
        self.assertIn(module.CUSTOMER_CUSTOM.encode(), result)
        self.assertIn(module.CUSTOMER_BARE.encode(), result)
        self.assertIn(module.RETAIL_CUSTOM.encode(), result)
        self.assertIn(module.MENU_CUSTOM.encode(), result)
        self.assertEqual(result.count(b"CORS_ALLOWED_ORIGINS="), 1)
        self.assertEqual(module.rewrite_content(result), (result, False))

    def test_preserves_crlf_and_existing_origins(self):
        data = (b"CORS_ALLOWED_ORIGINS=https://sichuan-hotpot-customer.vercel.app,"
                b"https://bepsi.click\r\nJWT_SECRET=placeholder\r\n")
        modified, changed = module.rewrite_content(data)
        self.assertTrue(changed)
        self.assertIn(b"https://bepsi.click,https://www.bepsi.click,https://sichuan-hotpot-admin.vercel.app,https://admin.bepsi.click,https://retail.bepsi.click,https://menu.bepsi.click\r\n", modified)
        self.assertTrue(modified.endswith(b"JWT_SECRET=placeholder\r\n"))

    def test_existing_custom_origins_remain_unique_when_adding_dinein(self):
        raw = (b"CORS_ALLOWED_ORIGINS=https://sichuan-hotpot-customer.vercel.app,"
               b"https://admin.bepsi.click,https://retail.bepsi.click\\n"
               b"OTHER_SECRET=never_log\\n")
        updated, changed = module.rewrite_content(raw)
        self.assertTrue(changed)
        self.assertEqual(updated.count(module.RETAIL_CUSTOM.encode()), 1)
        self.assertEqual(updated.count(module.MENU_CUSTOM.encode()), 1)
        self.assertIn(b"OTHER_SECRET=never_log\\n", updated)
        self.assertEqual(module.rewrite_content(updated), (updated, False))

    def test_fail_closed_missing_duplicate_or_invalid_origins(self):
        for value in (
            b"UNRELATED=1\n",
            b"CORS_ALLOWED_ORIGINS=https://sichuan-hotpot-customer.vercel.app\n"
            b"CORS_ALLOWED_ORIGINS=https://sichuan-hotpot-customer.vercel.app\n",
            b"CORS_ALLOWED_ORIGINS=https://evil.example\n",
            b"CORS_ALLOWED_ORIGINS=https://sichuan-hotpot-customer.vercel.app,\n",
            b"CORS_ALLOWED_ORIGINS=https://sichuan-hotpot-customer.vercel.app,http://unsafe.example\n",
        ):
            with self.subTest(value=value[:40]), self.assertRaises(module.Blocked):
                module.rewrite_content(value)

    def test_preflight_must_match_exact_origin_and_method(self):
        header = (b"HTTP/1.1 204 No Content\r\n"
                  + b"Access-Control-Allow-Origin: https://sichuan-hotpot-admin.vercel.app\r\n"
                  + b"Access-Control-Allow-Methods: GET,POST,PATCH,PUT,DELETE,OPTIONS\r\n\r\n")
        with patch.object(module, "run", return_value=(0, header)):
            self.assertTrue(module.good_preflight("http://127.0.0.1:3000", "PUT", "/auth/login", "content-type"))
        custom_header = header.replace(module.ADMIN.encode(), module.ADMIN_CUSTOM.encode())
        with patch.object(module, "run", return_value=(0, custom_header)):
            self.assertTrue(module.good_preflight("http://127.0.0.1:3000", "PUT", "/auth/login", "content-type", module.ADMIN_CUSTOM))
            self.assertFalse(module.good_preflight("http://127.0.0.1:3000", "PUT", "/auth/login", "content-type", module.ADMIN))
        with patch.object(module, "run", return_value=(0, header.replace(
                module.ADMIN.encode(), b"https://evil.example"))):
            self.assertFalse(module.good_preflight("http://127.0.0.1:3000", "POST", "/auth/login", "content-type"))
        with patch.object(module, "run", return_value=(22, b"")):
            self.assertFalse(module.good_preflight("http://127.0.0.1:3000", "POST", "/auth/login", "content-type"))

    def test_owner_only_no_auto_deploy_and_rollback(self):
        code = (ROOT / "hotpot-admin-cors.py").read_text()
        workflow = (ROOT.parents[1] / ".github/workflows/vps-admin-cors-owner.yml").read_text()
        self.assertIn("github.event.comment.body == '/fix-hotpot-pwa-cors'", workflow)
        self.assertIn("github.event.comment.body == '/fix-hotpot-dinein-cors'", workflow)
        self.assertIn("github.actor == 'meyecarpenter23842'", workflow)
        self.assertIn("environment: production-api", workflow)
        self.assertIn("StrictHostKeyChecking=yes", workflow)
        self.assertIn("persist-credentials: false", workflow)
        for auto in ("\n  push:", "\n  pull_request:", "\n  schedule:"):
            self.assertNotIn(auto, workflow)
        self.assertIn('atomic_replace(API_ENV, before, st)', code)
        self.assertIn('run(["/usr/bin/systemctl", "restart", SERVICE]', code)
        self.assertIn('pwa_cors=BLOCKED;reason=', code)


if __name__ == "__main__":
    unittest.main()
