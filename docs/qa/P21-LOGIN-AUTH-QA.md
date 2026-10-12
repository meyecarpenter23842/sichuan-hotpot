# P2.1 Login + authentication QA — October 12, 2026

Owner reference: [LoginScreen.png](../../LoginScreen.png). Actual hero: [login-hero.png](../../login-hero.png), deployed R2 object `hot-pot/system-image/login-hero.png`.

## Verified in an isolated sandbox (not production)
- **PASS**: exact public R2 object loads in Chromium, natural resolution 1448×1086 and MIME `image/png`; R2 object listing shows 2,381,942 bytes.
- **PASS**: Expo Web bundle compiled with a **disposable localhost backend**.
- **PASS**: Chromium headless 320/360/390/428/768 px: no document horizontal overflow, zero page JS errors, signup validation and guest browse; Google button correctly disabled without OAuth Client ID.
- **PASS**: actual NestJS HTTP API with locally migrated disposable PostgreSQL: register => HTTP 201 => `/auth/me` HTTP 200 CUSTOMER; logout HTTP 201; bad password HTTP 401 with correct UI message; re-login HTTP 201 and `/auth/me` HTTP 200.
- **PASS**: exact allowed-origin CORS preflight for customer PWA, unknown-origin excluded; unit/integration test added to required CI.
- **PASS**: no production deploy or DB migration.

## Repeatable CI evidence
`scripts/qa/p21-login-browser-qa.mjs` runs real browser HTTP tests against disposable CI PostgreSQL and uploads screenshots as the `p21-login-browser-screenshots` GitHub Actions artifact. Report PASS only once CI on the newest commit has succeeded.

## Remaining acceptance blockers (do not mark PASS)
- **NOT TESTED**: actual Google OAuth redirects, live Google ID token and backend Google audience using registered production Web/Android OAuth client identifiers. This requires a configured test domain/client and an authorized test user. CI tests backend identity mapping using a stubbed verifier; that does *not* prove live Google sign-in.
- **NOT TESTED**: Android emulator/native Google signing fingerprint, actual iPhone Safari installed PWA and real mobile keyboard/notch/safe-area behavior.
- **NOT TESTED**: visual pixel/typography comparison between actual login screenshots and the owner-supplied `LoginScreen.png`. Browser screenshots are generated as CI artifacts for manual comparison, but the reference image has not received a verified visual approval; do not claim 100% match.
- Password recovery endpoint is not yet implemented (UI says so instead of pretending otherwise).
- **NOT DEPLOYED**: production VPS/API and frontend remain on the previously deployed versions until an explicit manual release.

The P2.1 browser QA acceptance is **PARTIAL**, not overall P2.1 Done, until live Google and owner-reference visual/device QA are verified.
