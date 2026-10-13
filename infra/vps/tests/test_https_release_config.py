import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location("httpcfg",Path(__file__).parents[1]/"hotpot-https-release-config.py")
api=importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)


class HttpsHostTests(unittest.TestCase):
    @staticmethod
    def site(domain, *, ssl=True, proxy=True):
        return (f"server {{ listen 80; server_name {domain}; }}\nserver {{\n"
                f"listen {'443 ssl' if ssl else '8080'};\n"
                f"server_name {domain};\n"
                f"location / {{ proxy_pass {'http://127.0.0.1:3000' if proxy else 'http://127.0.0.1:8888'}; }}\n"
                f"}}\n")

    def check(self, files):
        with patch.object(api.glob, "glob", side_effect=lambda pattern: list(files)), \
             patch.object(api.Path, "is_file", return_value=True), \
             patch.object(api.Path, "read_text", side_effect=lambda *args, **kw: list(files.values()).pop(0)):
            return api.find_sites()

    def test_choose_unique_https_reverse_proxy(self):
        source=self.site("api.hotpot.example")
        with patch.object(api.glob, "glob",side_effect=[["/etc/nginx/sites-enabled/hotpot"],[]]),\
             patch.object(api.Path,"is_file",return_value=True),\
             patch.object(api.Path,"read_text",return_value=source):
            self.assertEqual(api.find_sites(),"api.hotpot.example")

    def test_skip_http_only_and_unrelated_service(self):
        with patch.object(api.glob, "glob",side_effect=[["/etc/nginx/sites-enabled/http"],[]]),\
             patch.object(api.Path,"is_file",return_value=True),\
             patch.object(api.Path,"read_text",return_value=self.site("api.hotpot.example", ssl=False)):
            with self.assertRaises(api.ConfigError):
                api.find_sites()

    def test_placeholder_and_wildcards_rejected(self):
        for host in ("API_DOMAIN","api.example.com","*.example.com","127.0.0.1"):
            with self.subTest(host=host), \
                 patch.object(api.glob,"glob",side_effect=[["/etc/nginx/sites-enabled/hotpot"],[]]),\
                 patch.object(api.Path,"is_file",return_value=True),\
                 patch.object(api.Path,"read_text",return_value=self.site(host)):
                with self.assertRaises(api.ConfigError):
                    api.find_sites()


if __name__=="__main__":
    unittest.main()
