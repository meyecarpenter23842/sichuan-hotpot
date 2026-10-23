# Retail Android Native — L04 release and device QA (#283)

**Current status (23 October 2026):** L01 PR #284, L02 #285 and L03 #286 merged. L04 adds release gates and a repeatable acceptance protocol; **a production Retail APK has NOT been certified or distributed**. CI uses a synthetic Firebase descriptor, an unreachable example API and a disposable debug certificate. These artifacts are not suitable for staff/customer use.

## Automated evidence and limits

| Check | Status | Evidence / scope |
| --- | --- | --- |
| Retail lint, TypeScript, unit tests; standalone JS APK on Linux and Windows | PASS for #286 | GitHub required PR checks, CI fixtures only |
| Customer/Admin Windows builds, native compatibility, workspace regressions | PASS for #286 | Same PR head `aa1eca6e` |
| Android API 35 emulator install, launcher and 4 screenshots | PASS for #286 | **Login screen only**; no server or staff login |
| Authenticated POS Web viewport 320/360/390/428/768/1024/1280/1440 and tablet landscape, toppings, QR approval, server billing | PASS for #286 | Playwright + disposable DB; **Web rendering, not Android hardware** |
| Production certificate / Firebase Android app / upgrade install | NOT TESTED | Must verify with the real original approved Retail keystore and Firebase app registration |
| Real phone/tablet authenticated POS, offline/reconnect, FCM sound/background, device share | NOT TESTED | Must be tested on physical Android hardware before distribution |
| USB/Bluetooth receipt printing | NOT IMPLEMENTED | OS share sheet is available; no hardware printer integration |

The CI job `retail-emulator-smoke` archives screenshots under artifact `retail-android-emulator-phone-tablet-CI-FIXTURE`. Capture new screenshots on physical devices; do not present browser captures as Native verification.

## Windows PowerShell release procedure

From `F:\1_A_Disk_D\hotpot`, **check and preserve local edits before fetching**:

```powershell
git status --short
git fetch origin
# Only on a clean, fast-forwardable main working tree:
git pull --ff-only
npm ci --include=dev --ignore-scripts --no-audit --no-fund
```

1. Register `vn.sichuanhotpot.retail` as a **separate Android client in the existing Firebase project**. Download its private per-build `google-services.json` to `apps/retail/google-services.json`; never commit it. Verify the project ID, package name and FCM permissions before building.
2. Use the **existing approved Retail keystore and its original alias/certificate** from secure offline storage. Set `HOTPOT_RETAIL_KEYSTORE_PATH`, `HOTPOT_RETAIL_KEYSTORE_PASSWORD`, `HOTPOT_RETAIL_KEY_ALIAS`, `HOTPOT_RETAIL_KEY_PASSWORD` and `HOTPOT_RETAIL_EXPECTED_SHA256` via private environment/secret store. Do not output private values, overwrite or generate a new keystore. If no Retail release certificate has ever been approved, block release until the signing identity is agreed and safely backed up. The first release freezes that identity.
3. Set the real HTTPS `EXPO_PUBLIC_API_BASE_URL` for Retail; ensure `CI`/`HOTPOT_FIREBASE_CI_FIXTURE` are **not set to `1`** when making a distributable APK.
4. Run the commands below only after confirming the generated `apps/retail/android` tree has no uncommitted custom edits. Do **not** use `expo prebuild --clean`.

```powershell
npm run android:prebuild --workspace @hotpot/retail
npm run android:release:retail
if ($LASTEXITCODE -ne 0) { throw "Retail release failed: do not distribute any APK" }
npm run android:sha1:retail
if ($LASTEXITCODE -ne 0) { throw "Retail certificate check failed" }
```

Build output: `dist/android/sichuan-hotpot-retail-release.apk`. The release script must verify its **fresh Gradle APK signature** against the pinned SHA-256 *before* publishing into `dist/android`; a failed run may leave an **older** previously approved file at that destination, so only distribute after the current command succeeds. Never rename/reuse a CI-fixture APK as production.

To check package and install side by side with Admin/Customer:

```powershell
$apk = "dist/android/sichuan-hotpot-retail-release.apk"
adb install -r $apk
if ($LASTEXITCODE -ne 0) { throw "Install failed (possible signing mismatch)" }
adb shell pm path vn.sichuanhotpot.retail
adb shell monkey -p vn.sichuanhotpot.retail -c android.intent.category.LAUNCHER 1
```

**Upgrade test:** install the approved previous version first, record its app data/session with a permitted test account, then `adb install -r` the newly built APK. It must install **in place** (no uninstall/data clear) and preserve expected state; compare old/new certificate SHA-256 with the Android SDK `apksigner verify --print-certs` using the same build-tools version. An `INSTALL_FAILED_UPDATE_INCOMPATIBLE` error means **stop**, never “fix” it by changing the key or uninstalling production.

## Hands-on Android phone + tablet acceptance (record PASS / FAIL / NOT TESTED)

For each row keep device model, Android version, APK SHA-256/certificate, app version, branch/role, steps and a screenshot/short video; use a disposable test table/order, not live customer data.

| Test | Phone 320–428dp | Tablet portrait 768dp | Tablet landscape 1024–1280dp |
| --- | --- | --- | --- |
| Login/logout, role scoping, resume after background/force-close, avoid showing another branch's data | NOT TESTED | NOT TESTED | NOT TESTED |
| Safe-area, Vietnamese labels, keyboard/password, Android back and 44dp touch targets | NOT TESTED | NOT TESTED | NOT TESTED |
| Open table, pick size/combo/shared topping, draft and POS split-layout | NOT TESTED | NOT TESTED | NOT TESTED |
| Rotate with an active **unsent** cart and with a frozen uncertain ticket, no loss/duplicate | NOT TESTED | NOT TESTED | NOT TESTED |
| QR guest request stays pending until staff approval; bill excludes rejected/pending items | NOT TESTED | NOT TESTED | NOT TESTED |
| Disable network during POST, restart, reconnect, retry **same idempotency key**; ensure one ticket/payment on server | NOT TESTED | NOT TESTED | NOT TESTED |
| Cash/QR payment confirmations, branch change, table close after due=0 and server state refresh | NOT TESTED | NOT TESTED | NOT TESTED |
| FCM correct branch/role, permission denied/granted, foreground/background, no duplicate WS+FCM chime | NOT TESTED | NOT TESTED | NOT TESTED |
| **Thử âm** emits one local notification with sound **without creating any ticket**; check silent mode | NOT TESTED | NOT TESTED | NOT TESTED |
| Receipt Share sheet works for authorized server totals; printer hardware is **out of scope** | NOT TESTED | NOT TESTED | NOT TESTED |

**Release gate:** do not mark #283 production-ready or send the APK to staff until all required real-device rows pass, signing identity/upgrade test passes, and Firebase/FCM has been tested end-to-end. CI green and merge do not deploy VPS, change PostgreSQL or attest physical-device behavior.

## CI QA commands (synthetic environment)

```bash
node --test scripts/test/android-retail-bootstrap.test.mjs
npm run lint --workspace @hotpot/retail
npm run typecheck --workspace @hotpot/retail
npm run test --workspace @hotpot/retail
# CI only: .github/workflows/retail-android-ci.yml builds fake-config APK
# and scripts/qa/retail-native-emulator-qa.sh checks login/rotation screenshots.
```

All manual results must be documented on [Issue #283](https://github.com/meyecarpenter23842/sichuan-hotpot/issues/283); record failures with root cause and fix by branch/PR, not by changing the official Retail certificate.
