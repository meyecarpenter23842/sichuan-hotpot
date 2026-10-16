import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    "cutover", Path(__file__).parents[1] / "hotpot-neon-cutover.py"
)
cutover = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cutover)


class NeonCutoverTests(unittest.TestCase):
    def test_pooler_url_becomes_direct_libpq_environment(self):
        values = {
            "DATABASE_URL": (
                "postgresql://hotpot_owner:test%40secret@"
                "ep-demo-pooler.c-6.us-east-2.aws.neon.tech/hotpot?sslmode=require"
            )
        }
        env = cutover.neon_process_env(values)
        self.assertEqual(env["PGHOST"], "ep-demo.c-6.us-east-2.aws.neon.tech")
        self.assertEqual(env["PGDATABASE"], "hotpot")
        self.assertEqual(env["PGPASSWORD"], "test@secret")
        self.assertEqual(env["PGSSLMODE"], "require")

    def test_local_or_unknown_database_is_rejected(self):
        for url in (
            "postgresql://u:p@127.0.0.1:5432/hotpot",
            "postgresql://u:p@db.example.com:5432/hotpot?sslmode=require",
        ):
            with self.subTest(url=url), self.assertRaisesRegex(
                cutover.CutoverError, "neon_database_configuration_required"
            ):
                cutover.neon_process_env({"DATABASE_URL": url})

    def test_script_never_prints_or_embeds_database_url(self):
        source = (Path(__file__).parents[1] / "hotpot-neon-cutover.py").read_text()
        self.assertNotIn("print(values", source)
        self.assertNotIn("print(url", source)
        self.assertIn("local_postgresql=DISABLED", source)
        self.assertIn("swap_guard=PASS", source)


if __name__ == "__main__":
    unittest.main()
