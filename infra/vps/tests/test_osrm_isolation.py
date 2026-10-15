import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "osrm"

class OsrmIsolationTests(unittest.TestCase):
    def test_loopback_only_and_resource_caps(self):
        compose = (ROOT / "compose.yml").read_text()
        self.assertIn("127.0.0.1:5000:5000", compose)
        self.assertIn("mem_limit: 768m", compose)
        self.assertIn("cpus: 0.75", compose)
        self.assertIn("/data:ro", compose)
        self.assertIn("read_only: true", compose)
        self.assertIn("osrm-routed", compose)
        self.assertIn("--algorithm", compose)
        self.assertIn("ch", compose)
        self.assertNotIn("0.0.0.0:5000", compose)

    def test_capacity_gate_blocks_small_host_and_never_starts_services(self):
        source = (ROOT / "preflight.sh").read_text()
        self.assertIn("mem_available_kib < 2 * 1024 * 1024", source)
        self.assertIn("mem_total_kib < 3 * 1024 * 1024", source)
        self.assertIn("hotpot-api.service", source)
        self.assertIn("postgresql.service", source)
        self.assertNotIn("systemctl restart", source)
        self.assertNotIn("docker compose", source)

    def test_no_deploy_without_manual_approval(self):
        script = (ROOT / "start-approved.sh").read_text()
        self.assertIn('--approved-start', script)
        self.assertIn('preflight.sh', script)
        self.assertIn('down', script)
        self.assertIn('OSRM_LOCAL_ROUTE=PASS', script)

    def test_capped_city_graph_preprocessing(self):
        script = (ROOT / "prepare-saigon-graph.sh").read_text()
        self.assertIn("Saigon.osm.pbf", script)
        self.assertIn("osrm-contract", script)
        self.assertIn("--memory=1400m", script)
        self.assertIn("--network=none", script)
        self.assertNotIn("vietnam-latest.osm.pbf", script)

if __name__ == "__main__":
    unittest.main()
