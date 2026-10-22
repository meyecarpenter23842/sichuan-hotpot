# Hotpot Retail — PWA and Android Native (#283)

Retail is the **same** Expo/React Native POS codebase for `https://retail.bepsi.click` and Android; both use the existing NestJS dining APIs, branches, tables, ticket state and server-calculated VND prices. Android is **not** a WebView of the PWA.

## Android bootstrap (first batch, not yet a production APK)

- Package: `vn.sichuanhotpot.retail`; launcher: `Hotpot Retail`; scheme: `sichuanhotpotretail`. Neither Admin nor Customer IDs or signing setup was changed.
- The `apps/retail/android` tree is generated locally and ignored by Git. The prebuild script **refuses** to destroy an existing native tree. Back up custom work and review before replacing it.
- Android Firebase descriptor must be for **Retail** and the existing Firebase project. Keep `apps/retail/google-services.json` out of Git. The synthetic GitHub Actions descriptor builds an APK **incapable of receiving real FCM**.
- Production Retail signing uses one separately preserved keystore and alias. The build validates the **pinned SHA-256** of its APK; a changed certificate is a hard error. Never regenerate/replace the keystore to fix a build. CI fixture signing is intentionally not suitable for distribution.
- Web remains unchanged. Native token persistence, device sound, push, receipt sharing, phone/tablet acceptance, and physical upgrade testing are **subsequent batches of Issue #283**, not claimed complete in this bootstrap.

## PowerShell (Windows, from `F:\1_A_Disk_D\hotpot`)

Inspect `git status --short` **before** pulling; do not discard local edits. Once the PR has merged and your working tree is clean:

```powershell
git fetch origin
git pull --ff-only
npm ci --include=dev --ignore-scripts --no-audit --no-fund
```

From Firebase Console obtain the Android client for `vn.sichuanhotpot.retail` in the existing Firebase project. Place it in `apps/retail/google-services.json` (ignored, do not commit). Configure the existing HTTPS API origin as `EXPO_PUBLIC_API_BASE_URL`. Before the **first distributable** release, provision a single durable, backed-up Retail release keystore and certificate outside the repository; record and preserve its SHA-256 separately.

Configure these in your private PowerShell session, secure credential store or CI secrets; **do not copy actual values into Git, issues, scripts or logs**:

- `HOTPOT_RETAIL_KEYSTORE_PATH`: absolute path to the fixed Retail keystore (not the Admin/Customer keystore).
- `HOTPOT_RETAIL_KEYSTORE_PASSWORD`, `HOTPOT_RETAIL_KEY_ALIAS`, `HOTPOT_RETAIL_KEY_PASSWORD`: values for that existing keystore.
- `HOTPOT_RETAIL_EXPECTED_SHA256`: pinned *public certificate* fingerprint, captured when the official key was first approved; this must not change between versions.

Build (safe only after the real descriptor and signing identity are verified):

```powershell
npm run android:prebuild --workspace @hotpot/retail
npm run android:release:retail
npm run android:sha1:retail
```

Output: `dist/android/sichuan-hotpot-retail-release.apk`. Check embedded `assets/index.android.bundle` (standalone, no Metro), expected package, SHA-1/SHA-256, then install alongside Admin and Customer. On the **next** Retail version, compare the same SHA and verify an in-place Android upgrade. Neither an emulated CI build nor successful merge proves this device upgrade.

## Verification (evidence, not assumptions)

- Source unit/lint/typecheck and web PWA regression: performed by workspace CI on the PR.
- Linux native release bundle and Windows matrix: checked by dedicated GitHub Actions workflows; both use **CI-only Firebase fixture and disposable signing**.
- Real phone and tablet portrait/landscape, Android keyboard/safe area, offline/reconnect, background/restart idempotency, FCM, sound, printer/share and upgrade: **NOT TESTED** in this first batch. Record later QA evidence for 320, 360, 390, 428, 768, 1024 and 1280dp.
- No production deploy, real order creation or production DB migration is performed by the Android build.

Refer to [Issue #283](https://github.com/meyecarpenter23842/sichuan-hotpot/issues/283) for all remaining native batches and acceptance requirements.
