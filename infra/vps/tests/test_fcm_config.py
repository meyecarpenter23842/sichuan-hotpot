"""Regression tests for owner-only FCM credential validation, no production reads."""
import importlib.util
from pathlib import Path
import unittest

SRC = Path(__file__).resolve().parents[1] / 'hotpot-fcm-config.py'
spec = importlib.util.spec_from_file_location('fcm_config', SRC)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FcmConfigTest(unittest.TestCase):
    def credential(self, project=None):
        import json
        return json.dumps({
            'type': 'service_account',
            'project_id': project or module.EXPECTED_PROJECT_ID,
            'client_email': 'firebase-adminsdk@test-project.iam.gserviceaccount.com',
            'private_key': '-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----\n',
            'token_uri': 'https://oauth2.googleapis.com/token',
        })

    def test_valid_shape_and_pem_escape(self):
        values, account = module.credential_values(self.credential())
        self.assertEqual(values['FCM_PROJECT_ID'], module.EXPECTED_PROJECT_ID)
        self.assertIn(r'\n', values['FCM_PRIVATE_KEY'])
        self.assertNotIn('\n', values['FCM_PRIVATE_KEY'])
        self.assertEqual(account['type'], 'service_account')

    def test_wrong_project_rejected(self):
        with self.assertRaisesRegex(module.FcmConfigError, 'wrong_firebase_project'):
            module.credential_values(self.credential('unrelated-project'))

    def test_non_service_account_rejected(self):
        for value in ('{}', '{"type":"authorized_user"}', '{"project_id":"yes"}'):
            with self.assertRaises(module.FcmConfigError):
                module.credential_values(value)

    def test_unrelated_env_preserved_and_idempotent(self):
        original = '# keep\nHOST=127.0.0.1\nPORT=3000\nDATABASE_URL=private-db\nFCM_PROJECT_ID=old\n'
        updates, _ = module.credential_values(self.credential())
        changed = module.render_env(original, updates)
        self.assertIn('DATABASE_URL=private-db', changed)
        self.assertEqual(changed.count('FCM_PROJECT_ID='), 1)
        self.assertEqual(changed.count('FCM_PRIVATE_KEY='), 1)
        self.assertEqual(module.render_env(changed, updates), changed)

    def test_duplicate_env_rejected(self):
        with self.assertRaisesRegex(module.FcmConfigError, 'unsafe_environment_format'):
            module.parse_env('HOST=127.0.0.1\nHOST=another\n')

    def test_newline_injection_rejected(self):
        import json
        account = json.loads(self.credential())
        account['client_email'] += '\nBACKDOOR=true'
        with self.assertRaisesRegex(module.FcmConfigError, 'invalid_service_account_email'):
            module.credential_values(json.dumps(account))


if __name__ == '__main__':
    unittest.main()
