# FCM HTTP v1 production bootstrap — Sichuan Hotpot

## Root cause (Android Admin video, 18 October 2026)
- Android grants notifications and obtains the Firebase device token, yet `POST /push/test` returns `FCM_SERVER_NOT_CONFIGURED`.
- This is the **backend** service-account credentials being absent, not missing Android SHA fingerprints. Do not rebuild APKs or require SHA fingerprints to fix this error.
- Both registered Android packages `vn.sichuanhotpot.admin` and `vn.sichuanhotpot.customer` use the operator's Firebase project `project-0fc02e8a-d32e-4ea9-884`. Service account must belong to this exact project.

## Configure once without committing keys

1. In the correct Firebase Console project, open **Project settings → Service accounts → Firebase Admin SDK → Generate new private key**. Enable the **Firebase Cloud Messaging API (HTTP v1)** for the project and ensure the service account has **Firebase Cloud Messaging API Admin** permission (or equivalent send permission). Do not post/share this JSON in chat, issues or source.
2. In this GitHub repo, open **Settings → Environments → production-api → Environment secrets**. Add `HOTPOT_FCM_SERVICE_ACCOUNT_JSON` with the **entire contents** of the downloaded service-account JSON. This is a server-only key, **not** either Android app's `google-services.json`.
3. On repository issue **#3**, post the owner-only command `/configure-hotpot-fcm`. Workflow `.github/workflows/vps-fcm-config-owner.yml` checks current main, key schema/project ID, Google OAuth, Firebase Messaging API permissions, pinned SSH, root-only env, and API health; it atomically installs `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY` without logging secrets. Failed restart triggers rollback.
4. On both signed Android apps, sign in and enable notifications, then use `Test thông báo` and `Test đầy đủ`. Successful Firebase acceptance is **not proof of Android delivery**; check the actual banner and sound on device (especially when app is backgrounded). App Customer and Admin testers show backend failure codes; do not create test orders unnecessarily.

## Security
- Never copy a service-account JSON into GitHub code, an APK, a public storage bucket or a chat message.
- Do not use CI Android APK artifacts for live FCM testing; CI bundles synthetic Firebase metadata.
- Secret rotation: replace protected GitHub Environment secret and rerun the owner command; revoke the old key only after successful verification.
- No Prisma migration is required. Production API health PASS after configuration does not automatically prove physical-device audio.
