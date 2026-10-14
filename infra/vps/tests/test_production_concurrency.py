"""Regression: skipped issue_comment workflows cannot cancel real VPS jobs."""
from pathlib import Path
import re
import unittest

ROOT=Path(__file__).resolve().parents[3]/".github/workflows"
OWNED={
    "vps-admin-cors-owner.yml":"admin-cors",
    "vps-api-release-manual.yml":"api",
    "vps-db-backup-manual.yml":"backup",
    "vps-db-manual.yml":"database",
    "vps-db-migrate-manual.yml":"migrate",
    "vps-first-owner-ci.yml":"owner",
}

class ProductionConcurrencyTests(unittest.TestCase):
    def test_shared_lock_is_job_scoped_only(self):
        for file, job in OWNED.items():
            with self.subTest(workflow=file):
                text=(ROOT/file).read_text()
                self.assertNotRegex(text,r"(?m)^concurrency:")
                self.assertRegex(text,
                    r"(?m)^jobs:\n(?:.*\n)*?  "+re.escape(job)+r":\n"
                    r"    concurrency:\n"
                    r"      group: hotpot-production-vps-change\n"
                    r"      cancel-in-progress: false\n")
                self.assertIn("if:",text)
                self.assertIn("environment:",text)
                self.assertEqual(text.count("hotpot-production-vps-change"),1)

    def test_issue_commands_require_exact_actor_and_comment(self):
        for file, cmd in [
            ("vps-api-release-manual.yml","/deploy-hotpot"),
            ("vps-first-owner-ci.yml","/bootstrap-hotpot-owner"),
            ("vps-admin-cors-owner.yml","/fix-hotpot-admin-cors"),
        ]:
            text=(ROOT/file).read_text()
            self.assertIn(cmd,text)
            self.assertIn("github.actor == 'meyecarpenter23842'",text)
            self.assertIn("cancel-in-progress: false",text)

if __name__=="__main__":
    unittest.main()
