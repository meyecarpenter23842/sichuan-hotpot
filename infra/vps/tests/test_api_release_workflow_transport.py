"""Regression coverage: production API owner release must stage over pinned SSH.

Static checks enforce transport and authorization invariants; live credentials
and production PostgreSQL are never accessed by tests.
"""
from pathlib import Path
import unittest


WORKFLOW = (Path(__file__).resolve().parents[3]
            / ".github/workflows/vps-api-release-manual.yml")


class OwnerReleaseWorkflowTests(unittest.TestCase):
    def test_stream_over_pinned_ssh_and_verify_before_deploy(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("github.event.comment.body == '/deploy-hotpot'", workflow)
        self.assertIn("github.actor == 'meyecarpenter23842'", workflow)
        self.assertIn("environment: production-api", workflow)
        self.assertIn("StrictHostKeyChecking=yes", workflow)
        self.assertIn("persist-credentials: false", workflow)
        self.assertIn("cat > '$remote_tmp'", workflow)
        self.assertIn('$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT.tgz', workflow)
        self.assertNotIn('scp -P "$VPS_PORT"', workflow)
        self.assertIn('test "$actual" = "$digest"', workflow)
        self.assertIn('test "$expected_helper" = "$actual_helper"', workflow)
        # Main-provenance gate, not a hand-maintained per-version allowlist.
        self.assertIn('git log --first-parent --format=%H -- "$helper_path"', workflow)
        self.assertIn('git show "$reviewed_commit:$helper_path"', workflow)
        self.assertIn('[[ "$reviewed_digest" == "$actual_helper" ]]', workflow)
        self.assertIn('[[ "$reviewed_helper" != true ]]', workflow)
        self.assertNotIn('expected_p42=', workflow)
        self.assertNotIn('expected_previous=', workflow)
        self.assertIn('sudo -n install -o root -g root -m 0600', workflow)
        self.assertIn('--verify-archive', workflow)
        self.assertIn("archive_validation=PASS", workflow)
        self.assertIn("health_live=PASS;health_ready=PASS", workflow)
        self.assertIn("release_sha=$REQUESTED_SHA", workflow)
        self.assertIn('runtime_build_step=[a-z_]+:(START|PASS)', workflow)
        self.assertIn('release_status="${PIPESTATUS[0]}"', workflow)
        self.assertIn('tee "$outcome_file"', workflow)
        self.assertIn('release_status != 0', workflow)
        self.assertIn("git rev-parse origin/main", workflow)

    def test_does_not_auto_release_or_migrate(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertNotIn("\n  push:", workflow)
        self.assertNotIn("\n  pull_request:", workflow)
        self.assertNotIn("\n  schedule:", workflow)
        self.assertNotIn("migrate deploy --schema apps/api/prisma/schema.prisma\\n          ssh", workflow)
        self.assertIn('test "$CONFIRM" = DEPLOY_API', workflow)


if __name__ == "__main__":
    unittest.main()
