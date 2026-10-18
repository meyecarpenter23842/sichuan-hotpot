# Android Customer/Admin persistent login and missed-order FCM

## Confirmed code cause (main 99e5ed94)
- Access token JWT lifetime is 15 minutes, refresh token 14 days, rotated as a one-time credential.
- Order polling/other protected API requests showed `401 Phiên đăng nhập đã hết hạn` with a stale access JWT instead of renewing and replaying a strictly rejected request. Thus the dashboard became stale and user assumed a logout; no invented orders/counts.
- Overlapping foreground/manual refreshes could each consume the same one-time refresh token; one succeeds and the other gets 401. Native tokens were stored in SecureStore already but recovery wasn't single-flight.
- Admin Android's `Thử kết nối lại` button previously did not retry the native restore at all.

## What changes
- API client retries **exactly once only after a 401**, never after network loss, timeout or 5xx, to avoid duplicate orders/actions. Uses a callback to a single application-owned session recovery.
- Native and PWA in-app refresh calls share the same pending operation. Access-token React state updates immediately after a successful recovery, reinitializing order polling/WebSocket/push subscription with a valid JWT.
- Customer/Admin secure persistence remains native SecureStore and web host-bound HttpOnly cookies. No refresh token logged or added to localStorage.
- Manual logout invalidates pending refreshes and clears local credentials. Temporary offline/API failures retain session and use backoff. Explicit backend revocation or expiration after 14 days without successful refresh still requires login (security boundary).
- No backend, DB, notification delivery or R2 changes. Do not claim FCM works without verifying backend FCM credentials and actual Android delivery.

## QA on real devices (CI does not prove this)
1. Log in Customer and Admin once. Keep both running for over 16 minutes, visit Admin Dashboard/Orders and Customer Account/Orders. No 401 banner, stale counts or unexpected login screen.
2. Turn off Internet for 1 minute; open Admin Orders. Expect an offline warning, *no forced logout*. Restore Internet; after reconnect, dashboard order count and list refresh without manual login.
3. Background both apps, then reopen after 20 minutes. Force-close normally/restart. Both should restore session and load fresh data.
4. Admin: Settings → Notification → **Làm mới**, **Test âm thanh**, then **Test thông báo**. Verify push token registration; Test âm local is not FCM. Create a real test order only for full order notification E2E; remove fixture if needed.
5. Logout explicitly. Reopen app: remain logged out. Backend revocation should still invalidate tokens.
6. Chrome/PWA two tabs and offline: check cookie and concurrent refresh behavior; Android and browser must not be marked PASS until tested. Server-side 14-day rotation means uninterrupted login is not guaranteed after inactivity beyond the security TTL.
