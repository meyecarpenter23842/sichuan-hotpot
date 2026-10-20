# Retail POS — Expo Web foundation

This is a deliberately **read-only** bootstrap. It is not a functioning POS or QR ordering service. It displays a clear inactive state and permits a manual /health/ready check only. No guest orders, staff permissions, payments, or fake products are enabled.

- `npm run lint --workspace @hotpot/retail`
- `npm run typecheck --workspace @hotpot/retail`
- `npm run test --workspace @hotpot/retail`
- `npm run build --workspace @hotpot/retail`
- `EXPO_PUBLIC_API_BASE_URL=https://<approved-api-origin> npm run web --workspace @hotpot/retail` (development)

Release must use the owner-only Issue #3 command after approved API/CORS/security and UI phases. `EXPO_PUBLIC_API_BASE_URL` is a **public HTTPS origin only**, never a secret.

Mobile/tablet/desktop breakpoints are intentionally lightweight at this stage. Final POS/menu screens require UX approval in #242 and API/permissions work in #243–#249.
