#!/usr/bin/env bash
set -euo pipefail

PACK_DIR="${1:-${RUNNER_TEMP:-/tmp}/stream-plan-v4-pack}"
OUTPUT_DIR="${2:-${RUNNER_TEMP:-/tmp}/stream-plan-v4-android-emulator-outputs}"
VERIFICATION_FILE="${3:-${RUNNER_TEMP:-/tmp}/android-stream-plan-v4-verification.json}"
INSTRUMENTATION_LOG="${RUNNER_TEMP:-/tmp}/android-stream-plan-v4-instrumentation.txt"

APP_APK="android-native/app/build/outputs/apk/debug/app-debug.apk"
TEST_APK="android-native/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"
TEST_COMPONENT="io.github.quickhardsub.test/androidx.test.runner.AndroidJUnitRunner"
TEST_CLASS="io.github.quickhardsub.StreamPlanV4RuntimeTest"

gradle -p android-native :app:assembleDebug :app:assembleDebugAndroidTest --stacktrace

test -s "$APP_APK"
test -s "$TEST_APK"

adb install -r -t "$APP_APK"
adb install -r -t "$TEST_APK"

rm -f "$INSTRUMENTATION_LOG"
adb shell am instrument -w \
  -e class "$TEST_CLASS" \
  "$TEST_COMPONENT" | tee "$INSTRUMENTATION_LOG"

if grep -q 'FAILURES!!!' "$INSTRUMENTATION_LOG"; then
  echo "Android instrumentation reported test failures." >&2
  exit 1
fi
if ! grep -Eq '^OK \([0-9]+ tests?\)$|^OK \(1 test\)$' "$INSTRUMENTATION_LOG"; then
  echo "Android instrumentation did not report a successful JUnit terminal result." >&2
  cat "$INSTRUMENTATION_LOG" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
rm -f "$OUTPUT_DIR"/*

while IFS= read -r name; do
  target="$OUTPUT_DIR/$name"
  adb exec-out run-as io.github.quickhardsub cat "files/device-acceptance-outputs/$name" > "$target"
  if [[ ! -s "$target" ]]; then
    echo "Missing or empty Android runtime output: $name" >&2
    exit 1
  fi
done < <(jq -r '.cases[].output' "$PACK_DIR/device-acceptance-cases.json")

node scripts/verify-stream-plan-v4-device-outputs.mjs \
  "$PACK_DIR" \
  "$OUTPUT_DIR" | tee "$VERIFICATION_FILE"

test -s "$VERIFICATION_FILE"
grep -q '"passed": 8' "$VERIFICATION_FILE"
grep -q '"total": 8' "$VERIFICATION_FILE"

echo "Android Stream Plan v4 emulator runtime acceptance: 8/8 verified."
