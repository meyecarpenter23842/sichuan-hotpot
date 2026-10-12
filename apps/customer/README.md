# Sichuan Hotpot — Expo customer app (P2)

React Native + Expo for Android and Expo Web PWA for iPhone Safari.

## Development
1. From monorepo root: `npm ci` then `npm run build -w @hotpot/shared` (if needed).
2. Set only public values in `apps/customer/.env.local` (see `.env.example`).
3. Start: `npm run start -w @hotpot/customer` or `npm run web -w @hotpot/customer`.
4. Validate: `npm run lint -w @hotpot/customer`, `npm run typecheck -w @hotpot/customer`, `npm run build -w @hotpot/customer`.

## Backend contract
- Anonymous `GET /catalog/branches`, `GET /catalog/branches/:id`.
- `POST /auth/register`, `POST /auth/login`, `POST /auth/google`, `POST /auth/refresh`, `GET /auth/me`.
- Google sign-in is direct OIDC with public OAuth Client IDs, **not Clerk**.
- On Android, supply an Android OAuth Client ID for the registered package + SHA-1; web needs the registered Web Client ID and authorized origins.
- Store tokens only in Expo SecureStore on Android. Web access token is in memory; reload requires reauthentication.
- Cart and the unverified local address draft use AsyncStorage. Address GPS needs opt-in; manual coordinates supported.
- **Do not attempt checkout yet.** P3 still needs routing quote, backend order creation, stock/pricing verification, idempotency and COD/QR. The app says so instead of faking an order.
- The PostgreSQL catalogue has no image URL field and R2 media are not yet populated, so product images are pending. Do not use UI reference screenshots as catalogue photos.

Production remains disabled. `vercel.json` must keep `git.deploymentEnabled=false`.

## P2.1 login and hero
- Owner references: `LoginScreen.png` (login layout) and `login-hero.png` (hero artwork).
- Login includes username/password registration/login and direct Google ID-token exchange via backend `/auth/google`; only a verified `/auth/me` response marks the user signed in.
- For the backend to accept Android + Web Google tokens, configure `GOOGLE_CLIENT_ID` plus `GOOGLE_WEB_CLIENT_ID`/`GOOGLE_ANDROID_CLIENT_ID` as needed. These are public OAuth client identifiers, not client secrets. Verify Google authorized origins and Android package/signing SHA.
- Expected hero R2 key: `hot-pot` bucket, `system-image/login-hero.png`; URL `https://pub-63ed7b1c33514906ab6e2d82f41bffce.r2.dev/system-image/login-hero.png`. If image is missing or request fails, UI shows a branded fallback, not a blank login page.
- R2 bucket **does not currently contain hero** at inspection time; this code does not claim successful upload. Place the owner's original binary at the exact key, verify content type image/png and HTTP GET before visual QA.
- No actual Android emulator, Safari PWA, real Google OAuth or pixel-match acceptance is claimed by a compile/build.

## Browser auth preflight (P2.1)
- The API must configure `CORS_ALLOWED_ORIGINS` to the comma-separated **exact HTTPS origins** of the deployed customer/admin PWAs. Local `http://localhost:<port>` is accepted only when explicitly listed. The API does **not** reflect arbitrary origins and does not use wildcard CORS.
- Example development setting: `CORS_ALLOWED_ORIGINS=http://localhost:8081`. Production origin is not known until the actual PWA deployment is configured; do not invent a domain or auto-deploy.
- For browser login, verify preflight `OPTIONS /auth/login`, `POST /auth/login`, `GET /auth/me`, refresh/revocation and a rejected unknown Origin. This is an actual cross-origin HTTP requirement, not optional presentation polish.

## P2.2 — customer catalogue, cart and addresses
- Catalogue returns server-managed modifier groups (including optional spice/sugar/ice/toppings), variant availability, and optional R2 product `imageKey` in `products-image/`. The UI must not invent products or prices.
- Cart persists IDs and quantities only; client displayed totals are estimates and the backend will validate at checkout in P3.
- Signed-in CUSTOMER can save up to ten addresses and phone on the backend, list/select/delete their own records. Guests can store only a local draft. Road-based delivery fee is not claimed or charged by P2.2.
- Additive Prisma migration `20261013000000_p2_catalog_modifiers` is DEV/CI only until an expressly approved production release.
