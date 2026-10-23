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
  local image="apps/retail/qa-artifacts/android-${mode}.png"
  test -s "$image"
  # A visible login text is not sufficient: ensure the archived screenshot
  # actually has the requested orientation, not a stale/wrong-sized frame.
  python3 - "$image" "$mode" <<'PY'
import struct
import sys
image, mode = sys.argv[1:]
with open(image, "rb") as handle:
    header = handle.read(24)
if len(header) != 24 or header[:8] != bytes.fromhex("89504e470d0a1a0a") or header[12:16] != b"IHDR":
    raise SystemExit("Android QA screenshot is not a valid PNG: " + mode)
width, height = struct.unpack(">II", header[16:24])
landscape = mode.endswith("landscape")
if width < 300 or height < 300 or (width > height) != landscape:
    raise SystemExit(f"Android QA wrong screenshot orientation: {mode} {width}x{height}")
print(f"Android QA screenshot verified: {mode} {width}x{height}")
PY
}

verify_login phone-portrait
adb shell settings put system accelerometer_rotation 0
adb shell settings put system user_rotation 1
sleep 3
verify_login phone-landscape
# Android wm size specifies the *natural*, unrotated display dimensions.
# This Pixel AVD is portrait-native: 800x1280 + rotation=1 gives 1280x800.
# Passing 1280x800 at rotation=1 incorrectly produces 800x1280 (portrait).
adb shell wm size 800x1280
adb shell wm density 160
adb shell settings put system user_rotation 1
sleep 5
verify_login tablet-landscape
adb shell settings put system user_rotation 0
sleep 5
verify_login tablet-portrait
echo "Android emulator launcher + portrait/landscape smoke: PASS (login view only)"
