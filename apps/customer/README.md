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
