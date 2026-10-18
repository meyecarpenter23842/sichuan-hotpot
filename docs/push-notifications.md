# Push notifications

This document records configuration names only. **Never commit Firebase service-account JSON, VAPID private keys, tokens, or production environment files.**

## Runtime behavior

- Admin new order: backend event after the non-idempotent order create succeeds.
  - Admin PWA: Web Push notification; browser/OS system sound.
  - Android Admin: FCM notification on channel `new-orders-v2`; packaged `new_order_alert.mp3`.
- Customer: push is sent only when an order reaches `CONFIRMED`.
  - Customer PWA: Web Push notification; browser/OS system sound.
  - Android Customer: FCM channel `customer-orders-v1` with default system sound.
- WebSocket remains the live data-sync transport. Push is an alert path, not the source of order state.

## API environment variables

Web Push:
- `WEB_PUSH_VAPID_PUBLIC_KEY`
- `WEB_PUSH_VAPID_PRIVATE_KEY`
- `WEB_PUSH_VAPID_SUBJECT` (for example a mailto URI owned by the operator)

FCM v1:
- `FCM_PROJECT_ID`
- `FCM_CLIENT_EMAIL`
- `FCM_PRIVATE_KEY`

Keep all values in the deployment secret/environment store.

## Android local build

Remote FCM notifications require the Android Firebase configuration for each native app at build time. Keep `google-services.json` outside Git and provide it only in the trusted local/build environment.

The approved Admin audio source is `/sound-native-android.mp3`. The Admin config plugin copies it during Android prebuild to the valid resource name `new_order_alert.mp3`.

After changing the custom Admin sound, use a new Android notification-channel ID rather than silently reusing an already-created channel.

## P0 Android FCM test and trusted build

1. Register **two Android apps** in the *same* Firebase project if desired:
   - `vn.sichuanhotpot.customer`
   - `vn.sichuanhotpot.admin`
2. Download each Android app's own `google-services.json`; place in `apps/customer/` and `apps/admin/` on the trusted build machine respectively. Do not upload to GitHub or paste into chat.
3. Run `npm ci`, then `npm run android:prebuild --workspace @hotpot/customer` and `npm run android:prebuild --workspace @hotpot/admin`. These now **refuse** to build without matching Firebase config.
4. Build APKs using `npm run android:release:customer` and `npm run android:release:admin`; use a trusted signing key for distribution as appropriate.
5. The backend must have working FCM HTTP v1 service-account credentials (`FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY`) for that same Firebase project. This is server-only; do not put service-account JSON in either APK.
6. Navigate to Admin → Thiết lập → Thông báo or Customer → Tôi → Kiểm tra thông báo. Tap **Test âm thanh** (local Android notification), **Test thông báo** (real Firebase HTTP v1), or **Test đầy đủ**.
7. Foreground test receives a receipt through the Expo notification listener and authenticated `POST /push/test/receipt`; only then will UI display "ĐÃ NHẬN". For background/normal-close tests, check device banner/sound and app resume manually. Force Stop is different.
8. Test calls rate limit to one real FCM send per device per 30 seconds. It never creates orders or changes revenue. Network failure, permission denial and wrong Firebase configuration are errors, not PASS.
9. CI uses an explicitly labeled, **nonfunctional** synthetic Firebase project solely to prove Gradle packaging with Google Services configured; these APK artifacts must not be used to sign off FCM.

Backend production requires a separately approved deployment after merge. Until then the API test endpoint is **not available** in production. WebSocket order sync stays independent.

**Test đầy đủ** delays the actual server-side FCM send by 12 seconds so the operator can background or normally close the app before delivery. The HTTP response is `scheduled`, **not** proof of send or receipt. Test status: `POST /push/test/status` with `testId`; a receipt is confirmed only by an observed device callback.

Admin Android notification channel is now `new-orders-v2` because Android channel sound settings are immutable once created. Local audio checks target that same channel with an explicit channelId. Older builds need to be rebuilt to receive the updated sound channel.


## L01 #195: real Android order sound and customer status push
- Android notification channels have immutable sound settings. A fresh channel `new-orders-v3`
  now points to bundled raw `new_order_alert.mp3`; local test and real FCM use the **same**
  channel. Admin Expo does not pre-create this channel via `defaultChannel`.
- Requires **new Admin APK**. Installing/updating JS alone does not bundle raw native sound.
  Android users can mute/change individual channel settings; the app cannot bypass system silence.
- Settings diagnostic reads the Android channel's actual sound name. Do not mark audio PASS
  until verified by ear on a device.
- Backend now notifies customers about CONFIRMED, PREPARING, READY, DELIVERING, DELIVERED,
  CANCELED and DELIVERY_FAILED. Cancellation and failed delivery include reasons when provided.
  A push tap opens existing order detail; reason also appears in status history.
- Test a **real** customer checkout and admin rejection, in foreground, background and when
  the app was normally closed (not Force Stop); compare against remote FCM test.
  CI builds and contract tests cannot certify delivery/audio on physical devices.
