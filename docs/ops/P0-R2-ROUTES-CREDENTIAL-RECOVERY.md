# R2 upload credentials (Google Routes retired)

> Historical filename retained for existing issue/PR links. **Do not provision Google Routes or add a Google API key.** All road-distance pricing now uses self-hosted OSRM; see [OSRM capacity and rollout](OSRM-SELFHOSTED-ROUTING.md).

## R2 image ticket HTTP 503 is separate from routing

Cloudflare R2 bucket `hot-pot` exists and PWA PUT CORS allows `https://admin.bepsi.click`. The Admin upload ticket cannot be signed without backend R2 S3-compatible credentials. This is **not** caused by GPS, OSRM, image size under the 2 MB limit, or Google.

The Cloudflare account owner must create a bucket-scoped **Object Read/Write** R2 token for `hot-pot` only. Do not reuse private PostgreSQL backup bucket credentials.

Store only these two values under GitHub repository Settings → Environments → `production-api` → Environment secrets:

| Secret name | Source |
|---|---|
| `HOTPOT_R2_ACCESS_KEY_ID` | Cloudflare R2 bucket-scoped S3 Access Key ID |
| `HOTPOT_R2_SECRET_ACCESS_KEY` | Matching Secret Access Key |

Never paste secrets into chat, issues, files, command-line arguments or client-side Expo/Vercel environment.

After storing both secrets **and** getting explicit production authorization, the repository owner can comment `/configure-hotpot-services` on Issue #3. The [protected workflow](../../.github/workflows/prod-services-configure.yml) verifies an actual R2 signed PUT → HEAD → DELETE of a noncustomer disposable object, atomically updates only the root-owned API R2 variables, restarts NestJS with health gates and restores the previous environment on failure. **No Google key/Google provider checks are involved.** API and database migrations are unrelated.

The OSRM provider is deployed independently only after VPS RAM requirements pass. An R2 workflow PASS does not establish OSRM/checkout readiness, and vice versa. Close incident [#117](https://github.com/meyecarpenter23842/sichuan-hotpot/issues/117) only once both R2 upload and route/checkout are verified on production.
