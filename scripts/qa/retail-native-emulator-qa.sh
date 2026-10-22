#!/usr/bin/env bash
set -euo pipefail
# This smoke checks the standalone APK's launcher, embedded JS and orientation
# using a synthetic CI API/Firebase only. It does NOT log in or validate FCM delivery.
apk="dist/android/sichuan-hotpot-retail-release.apk"
mkdir -p apps/retail/qa-artifacts
adb wait-for-device
adb install -r "$apk"
adb shell pm path vn.sichuanhotpot.retail | grep -Fq "package:"
adb shell am start -n vn.sichuanhotpot.retail/.MainActivity

verify_login() {
  local mode="$1"
  local ready=0
  for i in $(seq 1 22); do
    adb shell uiautomator dump /sdcard/retail-window.xml >/dev/null 2>&1 || true
    if adb shell cat /sdcard/retail-window.xml 2>/dev/null |
        grep -Fq 'Bán tại quán'; then
      ready=1
      break
    fi
    sleep 3
  done
  if [ "$ready" -ne 1 ]; then
    adb logcat -d -t 300 | grep -E 'FATAL EXCEPTION|AndroidRuntime|ReactNativeJS' | tail -60 || true
    echo "::error::Retail Android login screen was not visible ($mode)"
    exit 1
  fi
  adb exec-out screencap -p > "apps/retail/qa-artifacts/android-${mode}.png"
  test -s "apps/retail/qa-artifacts/android-${mode}.png"
}

verify_login phone-portrait
adb shell settings put system accelerometer_rotation 0
adb shell settings put system user_rotation 1
sleep 3
verify_login phone-landscape
adb shell wm size 1280x800
adb shell wm density 160
sleep 5
verify_login tablet-landscape
adb shell settings put system user_rotation 0
adb shell wm size 800x1280
sleep 5
verify_login tablet-portrait
echo "Android emulator launcher + portrait/landscape smoke: PASS (login view only)"
