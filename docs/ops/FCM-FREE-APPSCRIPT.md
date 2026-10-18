# Firebase FCM free relay (Google Apps Script)

## Why
Firebase Spark FCM is free. Cloud Shell `ADC_OK` and FCM HTTP 200 only prove the interactive **Cloud Shell** Google user can send; they do **not** grant Oracle VPS access. Project policy blocks new service-account private keys; Workload Identity Federation docs call for a project with Billing. This path needs neither a new key nor Cloud Run nor Blaze.

## Operator steps (do not share secrets in chat)

1. Open https://script.google.com/home/start and create a new standalone script named **Hotpot FCM Relay**. Replace its `Code.gs` with **the entire** `infra/fcm-appscript/Code.gs` from GitHub main.
2. In Apps Script → **Project Settings**, enable **Show "appsscript.json" manifest file in editor**. Replace `appsscript.json` with `infra/fcm-appscript/appsscript.json`.
3. Generate a fresh shared secret locally with `openssl rand -hex 32` in Cloud Shell. **Do not send the output anywhere public.** In Apps Script Project Settings → Script properties, add `HOTPOT_RELAY_SECRET_HEX` with this hex value.
4. Run `hotpotAuthorize` from the Apps Script editor while signed into the **same Google account that successfully ran FCM HTTP 200**. Grant Google OAuth permissions. Apps Script execution log must say `FCM_AUTH_OK`; otherwise do not proceed. Validation uses FCM `validate_only=true`: sends no device notification.
5. Apps Script → **Deploy → New deployment → Web app**. **Execute as: Me**, **Who has access: Anyone**. Copy URL with format `https://script.google.com/macros/s/.../exec`. Anyone access is necessary only to reach the endpoint; the app rejects unsigned requests with HMAC, timestamp and replay checks. Keep edit rights owner-only.
6. In GitHub repo → Settings → Environments → `production-api` → Environment secrets, create:
   - `HOTPOT_FCM_RELAY_URL`: published Apps Script `/exec` URL
   - `HOTPOT_FCM_RELAY_SECRET_HEX`: **the same** 64-hex secret from step 3
   Never put them into source code, an APK, Google Drive, Cloudflare R2 or a message.
7. From issue #3, the repository owner triggers `/configure-hotpot-fcm-appscript`. Owner-only GitHub Actions tests, uses pinned SSH and a signed **validate-only** probe before updating `/etc/sichuan-hotpot/api.env`, restarts API, verifies env/health and rolls back on failure.
8. Test **Admin → Thiết lập → Thông báo → Test thông báo**, then **Customer → Tôi → Kiểm tra thông báo**. Check app in foreground and background, banner and actual sound. Test uses existing endpoint and creates no order.

## Security and limitations
- Apps Script runs under the operator's user OAuth; its token stays inside Google and is refreshed by Google; no token is copied to Oracle VPS.
- Secret rotation: set a new hex value in Apps Script Script Properties and GitHub Environment secret, then rerun owner command. Expect test failures during rotation until both match.
- Apps Script has execution, URL Fetch and concurrency quotas. This is a low-volume fallback for one shop and is not an unlimited message broker. Avoid showing delivery as verified until devices receive FCM.
- Existing HTTP v1 server service-account path remains available if the project later permits keyless direct WIF or real service-account credentials.
- No database migration. APKs already built with the correct Firebase project IDs don't require rebuilding just to change backend FCM transport.
