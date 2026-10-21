# Retail POS — Sichuan Hotpot (L04 #246)

Staff-facing React Native + Expo Web PWA. **Not released to production until L09**. Local data is never used to create fake orders or to calculate the charged VND total.

## Features
- Staff username/password from the existing NestJS Auth API; branch selection from `GET /admin/orders/branches` (includes waiter/cashier memberships). Authoritative dining endpoints still check branch and role for every operation.
- Desktop/tablet: approximately 40/60 two-panel layout with separately scrollable bill and product grid; mobile: Bàn / Chọn món / Hóa đơn, retained draft when switching internal tabs.
- Real areas, tables, sessions, QR approval queue and public catalog. Periodic 5-second refresh plus refresh-on-resume recovers missed events / network loss. WebSocket push/notification sounds are L06.
- R2 product photos, available sizes, modifier/topping min/max requirements, combo components/choice groups, quantities and notes. Backend reprices; product card / local cart totals are **estimates only**.
- Staff ticket is created with a unique key; if the response is uncertain, the request payload and key stay frozen for an idempotent retry, preventing a second kitchen ticket.
- QR requests remain pending until staff approves. The same committed DiningTicket ID is the work-item identity. Rejection requires a reason.
- Cashier may see the bill but cannot call or approve food. Settlement/closing/canceling approved kitchen tickets are **not exposed** until the respective safe server workflows in L07.

## Security / limitations
- Staff JWT/refresh credentials exist in **in-memory state only**. Page reload currently requires sign-in again; do not put secrets into localStorage/URLs. A PWA same-origin HttpOnly refresh proxy and full session restoration must be audited before L09.
- API authority, idempotency, branch and role permissions, payment status and final price are never accepted from client input.
- Never switch branch or table while a draft exists; server requests still require a valid active session.
- Do not deploy Retail/Menu early. No production migration is introduced by L04.

## Development checks
```bash
npm run lint --workspace @hotpot/retail
npm run typecheck --workspace @hotpot/retail
npm run test --workspace @hotpot/retail
npm run build --workspace @hotpot/retail
```

Browser acceptance on CI: `scripts/qa/l04-retail-browser-qa.mjs` runs only against disposable localhost PostgreSQL with two authenticated browser contexts, including real table opening, staff ticket, guest QR approval and 360–1440px screenshots. The existing Customer and Admin browser regressions must pass on the same commit.
