# Push notifications

This document records configuration names only. **Never commit Firebase service-account JSON, VAPID private keys, tokens, or production environment files.**

## Runtime behavior

- Admin new order: backend event after the non-idempotent order create succeeds.
  - Admin PWA: Web Push notification; browser/OS system sound.
  - Android Admin: FCM notification on channel `new-orders-v1`; packaged `new_order_alert.mp3`.
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
