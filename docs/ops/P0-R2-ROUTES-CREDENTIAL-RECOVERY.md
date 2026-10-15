# P0 repair: R2 upload ticket 503 and Google driving-distance quote 503

## Confirmed cause

- Admin POST image ticket returns HTTP 503 **before** an R2 upload starts. The API signs S3 URLs only when R2 credentials are present and valid.
- Customer checkout requires **real road distance** calculated on the backend. A missing or denied Google Routes API key fails closed. Never substitute straight-line distance or 0đ shipping.
- Production read-only audits [#38713835066](https://github.com/meyecarpenter23842/sichuan-hotpot/actions/runs/38713835066) and [#38729795360](https://github.com/meyecarpenter23842/sichuan-hotpot/actions/runs/38729795360) confirmed the root-owned \`/etc/sichuan-hotpot/api.env\` lacks \`R2_ACCOUNT_ID\`, \`R2_ACCESS_KEY_ID\`, \`R2_SECRET_ACCESS_KEY\`, \`R2_BUCKET\`, \`GOOGLE_ROUTES_API_KEY\`.
- Cloudflare bucket \`hot-pot\` already has Admin PWA PUT/content-type CORS; changing CORS will not resolve an initial API 503.

## One-time credentials (GitHub protected environment, not chat/source)

The Google Cloud account administrator must enable **Routes API**, configure billing and create an API key allowed to call \`routes.googleapis.com\` **from the VPS backend** (not restricted to browser HTTP referrers). API restriction should permit only Routes API. For IP restrictions, use the server's verified outbound address; do not assume it without checking.

The Cloudflare R2 account administrator creates an R2 S3 API token with Object Read/Write permissions **scoped exclusively to bucket \`hot-pot\`**, **not** the private DB backups bucket. Keep the R2 Access Key ID and Secret Access Key private. Existing private DB backup credentials must not be reused for public product images.

Add the **three secret values** under repository Settings → Environments → \`production-api\` → Environment secrets:

| Protected secret name | Value source |
|---|---|
| \`HOTPOT_R2_ACCESS_KEY_ID\` | Scoped R2 access key ID |
| \`HOTPOT_R2_SECRET_ACCESS_KEY\` | Scoped R2 secret access key |
| \`HOTPOT_GOOGLE_ROUTES_API_KEY\` | Server-only Google Routes key |

Never add credentials to issue comments, commit history, local PWA env, Vercel \`EXPO_PUBLIC_*\` or a chat. Cloudflare account identifier and bucket are public configuration and pre-pinned in the reviewed installer.

## One owner command after provisioning

Post exactly this comment on **Issue #3** after secret provisioning:

\`/configure-hotpot-services\`

The [protected, owner-only workflow](../../.github/workflows/prod-services-configure.yml) will:

1. Check current \`main\`, private \`production-api\` secrets, pinned VPS host key and owner authorization.
2. Deliver the secret values from ephemeral runner memory/file to the root-only VPS helper over encrypted SSH stdin, never via URL/CLI argument or log.
3. **Before touching production:** validate token formats, issue R2 signed PUT and HEAD to a disposable \`products-image/_bootstrap-check/\` object, remove the object; call Google Routes with fixed public coordinates and ensure real distance is returned. Failure blocks the configuration, leaving API env unchanged.
4. Back up the existing root-only API env, atomically add/update five relevant keys while preserving all unrelated settings, restart API and check local \`/health/live\` and \`/health/ready\`.
5. Roll back the original environment and restart if health fails. Never run Prisma migrations or write production orders. Delete ephemeral helper, SSH files and runner payload.

A green run means **provider connectivity and API health checked**. It does not replace authorized real-browser tests: Admin product upload/preview/save/reload and Customer address quote/order, WebSocket/notification, or Safari/Android QA. Watch for any 403 due to token scope, 400 due to key API restrictions, or provider quota/billing denial before declaring success.

## Release / incident tracking

- Existing API deployment and both PWAs are on commit \`39d108cca8250ca436dca04d1e4ae741ffe84d0f\` (2026-10-15). Re-deploying this commit cannot create missing runtime secrets.
- Incident [#117](https://github.com/meyecarpenter23842/sichuan-hotpot/issues/117) stays open until this one-time installer **and** E2E functional testing PASS.
- No need to manually edit the VPS env or restart it in the terminal after using this workflow. No Windows F: synchronization is claimed by this PR.
