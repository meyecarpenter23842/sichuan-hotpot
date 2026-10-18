#!/usr/bin/python3
"""Install FCM HTTP v1 service account to root-only API env via pinned SSH stdin.

Never commit or print the credential. The root helper verifies real Firebase
OAuth and HTTP v1 project permission before changing production.
"""
from __future__ import annotations
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request

ENV_PATH = Path('/etc/sichuan-hotpot/api.env')
ROOT = Path('/opt/sichuan-hotpot/current')
SERVICE = 'hotpot-api.service'
EXPECTED_PROJECT_ID = 'project-0fc02e8a-d32e-4ea9-884'
FCM_KEYS = ('FCM_PROJECT_ID', 'FCM_CLIENT_EMAIL', 'FCM_PRIVATE_KEY')


class FcmConfigError(Exception):
    pass


def require(value: bool, code: str) -> None:
    if not value:
        raise FcmConfigError(code)


def credential_values(raw: str) -> tuple[dict[str, str], dict]:
    require(0 < len(raw) <= 24_576, 'invalid_credential_size')
    try:
        account = json.loads(raw)
    except (ValueError, TypeError) as exc:
        raise FcmConfigError('invalid_service_account_json') from exc
    require(isinstance(account, dict), 'invalid_service_account_json')
    require(account.get('type') == 'service_account', 'invalid_service_account_type')
    require(account.get('project_id') == EXPECTED_PROJECT_ID, 'wrong_firebase_project')
    address = account.get('client_email')
    require(isinstance(address, str) and bool(re.fullmatch(
        r'[a-zA-Z0-9_.-]+@[a-z0-9][a-z0-9-]*\.iam\.gserviceaccount\.com', address)),
        'invalid_service_account_email')
    key = account.get('private_key')
    require(isinstance(key, str) and key.startswith('-----BEGIN PRIVATE KEY-----\n')
            and key.endswith('-----END PRIVATE KEY-----\n')
            and len(key) < 10_000 and '\r' not in key,
            'invalid_private_key')
    require(account.get('token_uri') == 'https://oauth2.googleapis.com/token',
            'invalid_token_uri')
    return {
        'FCM_PROJECT_ID': EXPECTED_PROJECT_ID,
        'FCM_CLIENT_EMAIL': address,
        'FCM_PRIVATE_KEY': key.replace('\n', r'\n'),
    }, account


def parse_env(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in text.splitlines():
        if not line or line.startswith('#'):
            continue
        key, sep, value = line.partition('=')
        require(bool(sep) and bool(re.fullmatch(r'[A-Z][A-Z0-9_]*', key))
                and key not in values, 'unsafe_environment_format')
        values[key] = value
    return values


def render_env(text: str, updates: dict[str, str]) -> str:
    existing = parse_env(text)
    output: list[str] = []
    for line in text.splitlines():
        key, sep, _ = line.partition('=')
        if sep and key in updates and not line.startswith('#'):
            output.append(key + '=' + updates[key])
        else:
            output.append(line)
    for key in FCM_KEYS:
        if key not in existing:
            output.append(key + '=' + updates[key])
    return '\n'.join(output) + '\n'


def verify_provider(account: dict) -> None:
    """Validate OAuth token and Firebase Messaging API without contacting any device."""
    script = r'''
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const data = JSON.parse(fs.readFileSync(0, 'utf8'));
  const library = require(path.join(process.argv[1], 'node_modules/google-auth-library'));
  const oauth = new library.GoogleAuth({
    credentials: {client_email: data.client_email, private_key: data.private_key,
                  project_id: data.project_id},
    scopes: ['https://www.googleapis.com/auth/firebase.messaging']
  });
  const client = await oauth.getClient();
  const t = await client.getAccessToken();
  const token = typeof t === 'string' ? t : t?.token;
  if (!token) throw Error('no_auth_token');
  // A deliberately invalid token cannot deliver a notification.
  const response = await fetch('https://fcm.googleapis.com/v1/projects/' +
    encodeURIComponent(data.project_id) + '/messages:send', {
      method: 'POST',
      headers: {'Authorization':'Bearer ' + token,'Content-Type':'application/json'},
      body: JSON.stringify({message:{token:'not-a-device-token-for-preflight',
        notification:{title:'preflight',body:'no delivery'}}}),
      signal: AbortSignal.timeout(12000)
  });
  if (response.status !== 400) throw Error('fcm_provider_permission_or_api');
  const body = await response.json().catch(() => ({}));
  if (body?.error?.status !== 'INVALID_ARGUMENT') throw Error('invalid_provider_response');
})().then(() => process.exit(0)).catch(() => process.exit(1));
'''
    try:
        proc = subprocess.run(['/usr/bin/node', '-e', script, str(ROOT)],
                              input=json.dumps(account), text=True,
                              capture_output=True, timeout=35,
                              env={'PATH': '/usr/bin:/bin'})
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise FcmConfigError('provider_check_unavailable') from exc
    require(proc.returncode == 0, 'provider_auth_or_permission_failed')


def atomic_write(content: str, initial: os.stat_result) -> None:
    fd, tmp = tempfile.mkstemp(prefix='.api-env-fcm-', dir=ENV_PATH.parent)
    try:
        os.fchmod(fd, stat.S_IMODE(initial.st_mode))
        os.fchown(fd, initial.st_uid, initial.st_gid)
        with os.fdopen(fd, 'w') as out:
            out.write(content)
            out.flush()
            os.fsync(out.fileno())
        os.replace(tmp, ENV_PATH)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def restart_and_check() -> bool:
    try:
        subprocess.run(['/usr/bin/systemctl', 'restart', SERVICE],
                       check=True, timeout=25,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(10):
            try:
                for path in ('/health/live', '/health/ready'):
                    with urllib.request.urlopen('http://127.0.0.1:3000' + path,
                                                timeout=3) as res:
                        require(res.status == 200, 'api_health_failed')
                return True
            except (OSError, FcmConfigError):
                time.sleep(2)
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        pass
    return False


def configure(raw: str) -> str:
    require(os.geteuid() == 0, 'root_required')
    updates, account = credential_values(raw)
    st = os.lstat(ENV_PATH)
    require(stat.S_ISREG(st.st_mode) and st.st_uid == 0
            and (st.st_mode & 0o137) == 0, 'unsafe_environment_permissions')
    original = ENV_PATH.read_text()
    current = parse_env(original)
    require(current.get('HOST') == '127.0.0.1'
            and current.get('PORT') == '3000', 'unexpected_api_bind')
    verify_provider(account)
    updated = render_env(original, updates)
    if updated == original:
        require(restart_and_check(), 'api_health_failed')
        return 'ALREADY_READY'
    atomic_write(updated, st)
    if restart_and_check():
        return 'APPLIED'
    atomic_write(original, st)
    require(restart_and_check(), 'rollback_health_failed')
    raise FcmConfigError('rolled_back_after_failed_health')


def main() -> int:
    try:
        raw = sys.stdin.read(24_577)
        result = configure(raw)
        print('fcm_configuration=' + result + ';provider_auth=PASS;api_live=PASS;api_ready=PASS')
        return 0
    except FcmConfigError as exc:
        print('fcm_configuration=BLOCKED;reason=' + str(exc))
        return 1
    except Exception:
        print('fcm_configuration=BLOCKED;reason=unexpected_failure')
        return 1


if __name__ == '__main__':
    sys.exit(main())
