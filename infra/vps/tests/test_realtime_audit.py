import importlib.util
from pathlib import Path
import unittest

path = Path(__file__).resolve().parents[1] / "hotpot-realtime-audit.py"
spec = importlib.util.spec_from_file_location("hotpot_realtime_audit", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class NginxVhostAuditTests(unittest.TestCase):
    def test_server_contexts_and_matching_hostname(self):
        nginx = """
server {
 listen 443 ssl default_server;
 server_name _;
 location / { return 404; }
}
server {
 listen 443 ssl;
 server_name api.example.test;
 location /realtime {
  proxy_pass http://127.0.0.1:3000;
 }
 location / { proxy_pass http://127.0.0.1:3000; }
}
"""
        data = module.inspect(nginx, "api.example.test")
        self.assertEqual(data["nginx_tls_vhosts"], 2)
        self.assertEqual(data["nginx_host_tls_vhosts"], 1)
        self.assertEqual(data["nginx_host_tls_ws_locations"], 1)
        self.assertEqual(data["nginx_host_tls_api_upstreams"], 1)
        self.assertEqual(data["nginx_default_tls_vhosts"], 1)
        self.assertEqual(module.inspect(nginx, "not.example.test")["nginx_host_tls_vhosts"], 0)

    def test_no_sensitive_fields_emitted(self):
        self.assertEqual(set(module.KEYS), set(module.inspect("", "api.example.test")) | {
            "backend_upgrade_status", "local_tls_upgrade_status", "public_tls_upgrade_status"
        })


if __name__ == "__main__":
    unittest.main()
