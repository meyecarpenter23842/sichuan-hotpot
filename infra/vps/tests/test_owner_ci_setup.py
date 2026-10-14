"""Security and workflow tests for owner-only, no-local-key account bootstrap."""
import importlib.util
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch
import urllib.error

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location("owner_ci",ROOT/"hotpot-owner-ci-setup.py")
helper=importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)

class OwnerCiSetupTests(unittest.TestCase):
    def test_embedded_prisma_script_is_valid_and_uses_serializable_guard(self):
        checked=subprocess.run(["node","--check"],input=helper.JS,encoding="utf8",
            capture_output=True,check=False)
        self.assertEqual(checked.returncode,0)
        self.assertIn("pg_advisory_xact_lock",helper.JS)
        self.assertIn("TransactionIsolationLevel.Serializable",helper.JS)
        self.assertIn("randomBytes(48)",helper.JS)
        self.assertIn("Algorithm.Argon2id",helper.JS)
        self.assertIn("if(collision) throw",helper.JS)
        self.assertIn("role:'OWNER'",helper.JS)
        self.assertIn("ALREADY_EXISTS",helper.JS)
        self.assertNotIn("@Binh2401",helper.JS)

    def test_bootstrap_requests_email_only_after_database_success(self):
        order=[]
        with patch.object(helper.os,"geteuid",return_value=0), \
             patch.object(helper,"checked_environment",side_effect=lambda:order.append("env") or "db"), \
             patch.object(helper,"create_owner",side_effect=lambda _:order.append("db") or "CREATED"), \
             patch.object(helper,"issue_password_reset",side_effect=lambda:order.append("otp")):
            helper.main()
        self.assertEqual(order,["env","db","otp"])

        order.clear()
        with patch.object(helper.os,"geteuid",return_value=0), \
             patch.object(helper,"checked_environment",return_value="db"), \
             patch.object(helper,"create_owner",side_effect=lambda _:(_ for _ in ()).throw(helper.Blocked("database_bootstrap_failed"))), \
             patch.object(helper,"issue_password_reset",side_effect=lambda:order.append("bad")):
            with self.assertRaises(helper.Blocked):
                helper.main()
        self.assertEqual(order,[])

    def test_email_request_fails_closed(self):
        with patch.object(helper.request,"urlopen",
                          side_effect=urllib.error.URLError("test")):
            with self.assertRaisesRegex(helper.Blocked,"reset_email_not_sent"):
                helper.issue_password_reset()

    def test_owner_only_workflow_and_no_auto_trigger(self):
        flow=(ROOT.parents[1]/".github/workflows/vps-first-owner-ci.yml").read_text()
        self.assertIn("github.event.comment.body == '/bootstrap-hotpot-owner'",flow)
        self.assertIn("github.actor == 'meyecarpenter23842'",flow)
        self.assertIn("environment: production-api",flow)
        self.assertIn("StrictHostKeyChecking=yes",flow)
        self.assertIn("persist-credentials: false",flow)
        self.assertIn("hotpot-production-vps-change",flow)
        self.assertNotIn("\n  push:",flow)
        self.assertNotIn("\n  pull_request:",flow)
        self.assertNotIn("\n  schedule:",flow)
        self.assertNotIn("RESEND_API_KEY: ",flow)
        self.assertIn("password_exposed=no",flow)

if __name__=="__main__":
    unittest.main()
