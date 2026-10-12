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
