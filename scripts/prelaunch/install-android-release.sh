#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# shellcheck source=/dev/null
source "${ROOT_DIR}/mobile-app/scripts/source-local-build-env.sh"

ADB_BIN="${ADB_BIN:-adb}"
APK_PATH="${ANDROID_RELEASE_APK:-${ROOT_DIR}/mobile-app/android/app/build/outputs/apk/release/app-release.apk}"
APP_PACKAGE="${APP_PACKAGE:-br.com.leaf.ride}"

if ! command -v "$ADB_BIN" >/dev/null 2>&1; then
  for candidate in \
    "$HOME/Library/Android/sdk/platform-tools/adb" \
    "$HOME/Android/Sdk/platform-tools/adb" \
    "$ROOT_DIR/platform-tools/adb"; do
    if [[ -x "$candidate" ]]; then
      ADB_BIN="$candidate"
      break
    fi
  done
fi

if ! command -v "$ADB_BIN" >/dev/null 2>&1 && [[ ! -x "$ADB_BIN" ]]; then
  echo "[prelaunch][android] adb nao encontrado"
  exit 1
fi

if [[ ! -f "$APK_PATH" ]]; then
  echo "[prelaunch][android] APK nao encontrado: $APK_PATH"
  exit 1
fi

ADB_ARGS=()
if [[ -n "${ANDROID_SERIAL:-}" ]]; then
  ADB_ARGS=(-s "$ANDROID_SERIAL")
fi

adb_cmd() {
  if [[ ${#ADB_ARGS[@]} -gt 0 ]]; then
    "$ADB_BIN" "${ADB_ARGS[@]}" "$@"
  else
    "$ADB_BIN" "$@"
  fi
}

adb_cmd get-state >/dev/null
adb_cmd install -r "$APK_PATH"
adb_cmd shell am start -n "${APP_PACKAGE}/.MainActivity" >/dev/null 2>&1 \
  || adb_cmd shell monkey -p "$APP_PACKAGE" -c android.intent.category.LAUNCHER 1 >/dev/null

echo "[prelaunch][android] release instalado e aberto: $APK_PATH"
