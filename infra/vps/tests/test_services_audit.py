import unittest
import importlib.util
from pathlib import Path

source = Path(__file__).resolve().parents[1] / "hotpot-services-audit.py"
spec = importlib.util.spec_from_file_location("hotpot_services_audit", source)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class ServicesAuditTests(unittest.TestCase):
    def test_only_reports_presence_or_invalidity(self):
        values = "\n".join([
            "R2_ACCOUNT_ID=" + "a" * 32,
            "R2_ACCESS_KEY_ID=ABC123abc456",
            "R2_SECRET_ACCESS_KEY=LOCAL_FAKE_VALUE_NEVER_A_REAL_SECRET",
            "R2_BUCKET=hot-pot",
        ])
        self.assertEqual(set(mod.statuses(values).values()), {"PRESENT"})
        self.assertEqual(len(mod.statuses(values)), 4)

    def test_missing_duplicates_and_invalid_values(self):
        states = mod.statuses("R2_BUCKET=wrong\nR2_BUCKET=hot-pot\nR2_ACCOUNT_ID=invalid")
        self.assertEqual(states["R2_BUCKET"], "DUPLICATE")
        self.assertEqual(states["R2_ACCOUNT_ID"], "INVALID_FORMAT")
        self.assertEqual(states["R2_SECRET_ACCESS_KEY"], "MISSING")


if __name__ == "__main__":
    unittest.main()
