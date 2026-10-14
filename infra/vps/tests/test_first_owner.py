"""First owner onboarding fails closed unless an email OTP is verified."""
import importlib.util
import io
import json
from pathlib import Path
from unittest.mock import patch
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location("first_owner",ROOT/"hotpot-first-owner.py")
app=importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)
identity={"username":"ownerqa","email":"owner@example.test","password":"unique-nine"}


class FirstOwnerTests(unittest.TestCase):
    def test_identity_validation_rejects_unsafe_fields(self):
        self.assertEqual(app.parse_identity(json.dumps(identity).encode()),identity)
        for value in (
            dict(identity,username="ROOT"),dict(identity,email="A@B.com"),
            dict(identity,password="x"),dict(identity,password="a\nb"*5),
            dict(identity,role="OWNER"),dict(identity,email="someone@else.test\nfoo"),
        ):
            with self.subTest(value=list(value)),self.assertRaises(app.Blocked):
                app.parse_identity(json.dumps(value).encode())

    def test_otp_has_exact_format_and_expiry(self):
        with patch.object(app.select,"select",return_value=([object()],[],[])):
            self.assertTrue(app.otp_matches(io.BytesIO(b"123456\n"),"123456",0))
            self.assertFalse(app.otp_matches(io.BytesIO(b"999999\n"),"123456",0))
            self.assertFalse(app.otp_matches(io.BytesIO(b"12345\n"),"123456",0))
        with patch.object(app.select,"select",return_value=([],[],[])):
            self.assertFalse(app.otp_matches(io.BytesIO(b"123456\n"),"123456",0))

    def test_no_database_create_without_verified_otp(self):
        packet=json.dumps(identity).encode()+b"\n"
        steps=[]
        with patch.object(app.os,"geteuid",return_value=0), \
             patch.object(app.sys,"stdin",io.TextIOWrapper(io.BytesIO(packet))), \
             patch.object(app,"checked_env",return_value={
                 "DATABASE_URL":"test-db","RESEND_API_KEY":"test-key",
                 "HOTPOT_MAIL_FROM":"noreply@bepsi.click"}), \
             patch.object(app,"node_step",side_effect=lambda mode,*rest:steps.append(mode)), \
             patch.object(app,"mail_otp"), \
             patch.object(app,"otp_matches",return_value=False), \
             patch.object(app.secrets,"randbelow",return_value=123456):
            with self.assertRaises(app.Blocked):
                app.main()
        self.assertEqual(steps,["preflight"])

    def test_create_only_after_otp_verified(self):
        packet=json.dumps(identity).encode()+b"\n"
        steps=[]
        with patch.object(app.os,"geteuid",return_value=0), \
             patch.object(app.sys,"stdin",io.TextIOWrapper(io.BytesIO(packet))), \
             patch.object(app,"checked_env",return_value={
                 "DATABASE_URL":"test-db","RESEND_API_KEY":"test-key",
                 "HOTPOT_MAIL_FROM":"noreply@bepsi.click"}), \
             patch.object(app,"node_step",side_effect=lambda mode,*rest:steps.append(mode)), \
             patch.object(app,"mail_otp"), \
             patch.object(app,"otp_matches",return_value=True), \
             patch.object(app.secrets,"randbelow",return_value=123456):
            app.main()
        self.assertEqual(steps,["preflight","create"])

    def test_owner_insert_is_atomic_guarded_and_password_hashed(self):
        code=app.NODE_JS
        self.assertIn("pg_advisory_xact_lock",code)
        self.assertIn("TransactionIsolationLevel.Serializable",code)
        self.assertIn("if (!await eligible(tx))",code)
        self.assertIn("Algorithm.Argon2id",code)
        self.assertIn("verifiedEmail:input.email",code)
        self.assertIn("user:{create:{role:'OWNER'}}",code)
        runner=(ROOT.parents[1]/"scripts/ops/bootstrap-first-owner.ps1").read_text()
        self.assertIn("Read-Host 'New OWNER password' -AsSecureString",runner)
        self.assertIn("Read-Host 'Six-digit OWNER email OTP' -AsSecureString",runner)
        self.assertIn("StrictHostKeyChecking=yes",runner)
        self.assertIn("$process.StandardInput.WriteLine($packet)",runner)
        self.assertNotIn("Write-Host $packet",runner)


if __name__=="__main__":
    unittest.main()
