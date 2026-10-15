import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

path = Path(__file__).resolve().parents[1] / "hotpot-realtime-nginx.py"
spec = importlib.util.spec_from_file_location("hotpot_realtime_nginx", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RealtimeNginxTests(unittest.TestCase):
    def test_adds_only_one_tls_websocket_location(self):
        original = """
server {
 listen 80;
 location / { return 308 https://example.test$request_uri; }
}
server {
 listen 443 ssl;
 server_name example.test;
 location / {
  proxy_pass http://127.0.0.1:3000;
 }
}
"""
        result = module.upgraded(original)
        self.assertIn("proxy_set_header Upgrade $http_upgrade;", result)
        self.assertIn('proxy_set_header Connection "upgrade";', result)
        self.assertIn("return 308", result)
        self.assertEqual(result, module.upgraded(result))

    def test_ambiguous_tls_proxies_refused(self):
        conf = """
server { listen 443 ssl; location / { proxy_pass http://127.0.0.1:3000; } }
server { listen 443 ssl; location / { proxy_pass http://127.0.0.1:3000; } }
"""
        with self.assertRaises(module.RealtimeConfigError):
            module.upgraded(conf)

    def test_unknown_existing_realtime_refused(self):
        conf = """
server {
 listen 443 ssl;
 location /realtime { proxy_pass http://127.0.0.1:3000; }
 location / { proxy_pass http://127.0.0.1:3000; }
}
"""
        with self.assertRaises(module.RealtimeConfigError):
            module.upgraded(conf)


class RealtimeRouteTests(unittest.TestCase):
    def test_three_stage_check_and_no_public_bypass(self):
        with (patch.object(module, "check_upgrade") as check,
              patch.object(module, "effective_nginx_route")):
            module.verify_route("https://api.example.test")
        self.assertEqual(check.call_count, 3)
        self.assertEqual(check.call_args_list[0].kwargs["stage"], "backend")
        self.assertEqual(check.call_args_list[1].kwargs["stage"], "nginx_local")
        self.assertEqual(check.call_args_list[2].kwargs["stage"], "public")

    def test_verify_route_waits_for_nginx_worker_reload(self):
        seen = []
        def handshake(origin, *, stage="public", **kwargs):
            seen.append(stage)
            if stage == "nginx_local" and seen.count("nginx_local") == 1:
                raise module.RealtimeConfigError("nginx_local_route_missing")
        with (patch.object(module, "check_upgrade", side_effect=handshake),
              patch.object(module, "effective_nginx_route"),
              patch.object(module.time, "sleep") as sleep):
            module.verify_route("https://api.example.test")
        self.assertEqual(seen, ["backend", "nginx_local", "nginx_local", "public"])
        sleep.assert_called_once_with(1)

    def test_invalid_origin_never_bypasses_tls_validation(self):
        with self.assertRaises(module.RealtimeConfigError):
            module.check_upgrade("http://example.test")

    def test_rejects_non_https_origin(self):
        with self.assertRaises(module.RealtimeConfigError):
            module.check_upgrade("http://example.test")
