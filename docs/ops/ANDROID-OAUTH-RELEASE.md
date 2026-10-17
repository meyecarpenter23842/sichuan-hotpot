# Android release: API configuration and Google OAuth

## One SHA-1 per signing certificate, not per customer

For Customer Android, the OAuth Android client in Google Cloud must allow:
- **Package name:** `vn.sichuanhotpot.customer`.
- **SHA-1:** the certificate fingerprint of the APK actually installed, or the Google Play **app signing** certificate for Play Store distributions.
- The **Web OAuth client ID** used by `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` must belong to the compatible Google Cloud OAuth project.

Different signing keys (local debug, production keystore, Google Play app signing) can require additional Android OAuth client registrations. All customers who install the same signed release share its OAuth configuration. Do not register a new SHA for each phone. Registering a certificate with Google Cloud does not require rebuilding an unchanged APK; changing the bundled Web client ID does require rebuilding.

After building Customer on Windows, run from repository root:

```powershell
npm run android:sha1:customer
```

This reads the **APK's signing certificate** using the installed Android SDK. It does not print or export a private signing key. If the command warns about a DEBUG key, use this only for testing. Do not distribute an APK signed with a local debug keystore as the final release. For Google Play, register Play Console's app signing SHA-1, not the developer's upload-key SHA-1.

## App-specific API environment

Expo inlines `EXPO_PUBLIC_*` during bundling. Both apps have independent project roots and need their own valid release API origin:

- `apps/customer/.env.local`: `EXPO_PUBLIC_API_BASE_URL` and `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`
- `apps/admin/.env.local`: `EXPO_PUBLIC_API_BASE_URL`

Values must point to the real reachable HTTPS backend, using a hostname/certificate trusted by Android. The Admin login uses `/auth/login`; the Customer Google login first obtains a Google token, then calls `/auth/google` against this API. If the API is deployed behind an IP address whose TLS certificate does not match the IP, Android will fail to connect; do not disable HTTPS/TLS verification.

These .env files are local, ignored by Git, and **must not be committed**. Values such as `https://api-ci.invalid` in Windows GitHub Actions are only for compilation checks: artifacts from CI cannot log in or place orders.

After changing environment variables, rebuild the affected APK:

```powershell
npm run android:release:customer
npm run android:release:admin
```

The release script now checks inputs **before** Gradle so it cannot silently package an empty/test API origin on a normal local build. It does not re-run `prebuild --clean` or remove uncommitted Android native files.

## Troubleshooting

- **Admin: Missing/invalid API configuration** means the release APK has no valid API origin. Check the app-specific .env file and rebuild.
- **Admin: HTTPS connection failed** means a network, DNS, server, or TLS problem; check the backend health through the same hostname on the Android device. Admin does not use Google sign-in.
- **Customer: Google package/SHA-1 mismatch** is an OAuth Android client configuration failure, not a per-user registration problem.
- **Google's phone-number account verification screen** is Google Play Services/account UI. On an emulator, prefer a system image with Google Play Services; follow Google's available alternative sign-in options.

Do not store Google OAuth private credentials, Android keystores, passwords, or `.env.local` in Git.
