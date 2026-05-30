#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PROFILE="${1:-production}"
EAS_JSON="${ROOT_DIR}/eas.json"
APP_CONFIG="${ROOT_DIR}/app.config.js"

FAIL=0

fail() {
  echo "[release-preflight][fail] $1" >&2
  FAIL=1
}

pass() {
  echo "[release-preflight][pass] $1"
}

truthy() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

require_tool() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "$1 não encontrado"
  fi
}

require_tool jq
require_tool npx
require_tool node
require_tool rg

if [[ ! -f "$EAS_JSON" ]]; then
  fail "eas.json não encontrado"
elif ! jq -e --arg profile "$PROFILE" '.build[$profile]' "$EAS_JSON" >/dev/null; then
  fail "perfil EAS inexistente: $PROFILE"
fi

if [[ "$FAIL" -ne 0 ]]; then
  exit 2
fi

while IFS=$'\t' read -r key value; do
  [[ -z "$key" ]] && continue
  export "$key=$value"
done < <(jq -r --arg profile "$PROFILE" '.build[$profile].env // {} | to_entries[] | [.key, (.value | tostring)] | @tsv' "$EAS_JSON")

echo "[release-preflight] Perfil EAS: $PROFILE"
export EAS_BUILD_PROFILE="${EAS_BUILD_PROFILE:-$PROFILE}"
export LEAF_BUILD_PROFILE="${LEAF_BUILD_PROFILE:-$PROFILE}"

DANGEROUS_FLAGS=(
  APP_REVIEW
  EXPO_PUBLIC_APP_REVIEW
  EXPO_PUBLIC_E2E_TEST
  EXPO_PUBLIC_FORCE_PAYMENT_BYPASS
  EXPO_PUBLIC_BYPASS_PAYMENTS
  EXPO_PUBLIC_ENABLE_TEST_USER_TOOLS
  EXPO_PUBLIC_ENABLE_CUSTOM_OTP_FALLBACK
  EXPO_PUBLIC_ENABLE_QA_OTP_FORCE_FLOW
  EXPO_PUBLIC_ALLOW_CLIENT_DIRECT_GOOGLE_FALLBACK
  EXPO_PUBLIC_ALLOW_INSECURE_HTTP
)

for flag in "${DANGEROUS_FLAGS[@]}"; do
  value="${!flag:-}"
  if truthy "$value"; then
    fail "$flag está ativo (${value})"
  else
    pass "$flag não está ativo"
  fi
done

TMP_PUBLIC_JSON="$(mktemp "${TMPDIR:-/tmp}/leaf-release-public.XXXXXX")"
TMP_PREBUILD_JSON="$(mktemp "${TMPDIR:-/tmp}/leaf-release-prebuild.XXXXXX")"
trap 'rm -f "$TMP_PUBLIC_JSON" "$TMP_PREBUILD_JSON"' EXIT

npx expo config --type public --json > "$TMP_PUBLIC_JSON"
npx expo config --type prebuild --json > "$TMP_PREBUILD_JSON"

check_json_false() {
  local file="$1"
  local query="$2"
  local label="$3"
  local value
  value="$(jq -r "$query" "$file")"
  if [[ "$value" == "false" || "$value" == "null" || "$value" == "" ]]; then
    pass "$label=false"
  else
    fail "$label está ativo na config final (${value})"
  fi
}

check_json_false "$TMP_PUBLIC_JSON" '.extra.isReview // false' "extra.isReview"
check_json_false "$TMP_PUBLIC_JSON" '.extra.e2eTest // false' "extra.e2eTest"
check_json_false "$TMP_PUBLIC_JSON" '.extra.forcePaymentBypass // false' "extra.forcePaymentBypass"
check_json_false "$TMP_PUBLIC_JSON" '.extra.enableTestUserTools // false' "extra.enableTestUserTools"
check_json_false "$TMP_PUBLIC_JSON" '.extra.allowClientDirectGoogleFallback // false' "extra.allowClientDirectGoogleFallback"

ANDROID_PACKAGE="$(jq -r '.android.package // ""' "$TMP_PUBLIC_JSON")"
IOS_BUNDLE="$(jq -r '.ios.bundleIdentifier // ""' "$TMP_PUBLIC_JSON")"
APP_NAME="$(jq -r '.name // ""' "$TMP_PUBLIC_JSON")"
APP_SLUG="$(jq -r '.slug // ""' "$TMP_PUBLIC_JSON")"
APP_VERSION="$(jq -r '.version // ""' "$TMP_PUBLIC_JSON")"
APP_RUNTIME_VERSION="$(jq -r '.runtimeVersion // ""' "$TMP_PUBLIC_JSON")"
EXPECTED_APP_VERSION="$(node -e "console.log(require('./config/AppConfig').AppConfig.ios_app_version)")"
UPDATES_ENABLED="$(jq -r '.updates.enabled // true' "$TMP_PREBUILD_JSON")"
UPDATES_CHANNEL="$(jq -r '.updates.requestHeaders["expo-channel-name"] // ""' "$TMP_PREBUILD_JSON")"
ANDROID_ICON="$(jq -r '.android.icon // ""' "$TMP_PUBLIC_JSON")"
ANDROID_FOREGROUND="$(jq -r '.android.adaptiveIcon.foregroundImage // ""' "$TMP_PUBLIC_JSON")"
SPLASH_ANDROID="$(jq -r '.plugins[]? | select(type == "array" and .[0] == "expo-splash-screen") | .[1].android.image // ""' "$TMP_PUBLIC_JSON")"
ALLOW_HTTP="$(jq -r '.ios.infoPlist.NSAppTransportSecurity.NSAllowsArbitraryLoads // false' "$TMP_PREBUILD_JSON")"
LOCAL_NETWORKING="$(jq -r '.ios.infoPlist.NSAppTransportSecurity.NSAllowsLocalNetworking // false' "$TMP_PREBUILD_JSON")"
IOS_MICROPHONE_USAGE="$(jq -r '.ios.infoPlist.NSMicrophoneUsageDescription // ""' "$TMP_PREBUILD_JSON")"
NATIVE_IOS_INFO_PLIST="${ROOT_DIR}/ios/Leaf/Info.plist"
NATIVE_IOS_MICROPHONE_USAGE=""

if [[ -f "$NATIVE_IOS_INFO_PLIST" ]]; then
  NATIVE_IOS_MICROPHONE_USAGE="$(/usr/libexec/PlistBuddy -c "Print :NSMicrophoneUsageDescription" "$NATIVE_IOS_INFO_PLIST" 2>/dev/null || true)"
fi

if [[ "$ANDROID_PACKAGE" == "br.com.leaf.ride" ]]; then
  pass "Android package correto: $ANDROID_PACKAGE"
else
  fail "Android package divergente: ${ANDROID_PACKAGE:-<vazio>}"
fi

if [[ "$IOS_BUNDLE" == "br.com.leaf.ride" ]]; then
  pass "iOS bundleIdentifier correto: $IOS_BUNDLE"
else
  fail "iOS bundleIdentifier divergente: ${IOS_BUNDLE:-<vazio>}"
fi

if [[ "$APP_NAME" == "Leaf" && "$APP_SLUG" == "leafapp-reactnative" && "$APP_VERSION" == "$EXPECTED_APP_VERSION" && "$APP_RUNTIME_VERSION" == "$EXPECTED_APP_VERSION" ]]; then
  pass "Expo config principal correta: $APP_NAME/$APP_SLUG v$APP_VERSION runtime $APP_RUNTIME_VERSION"
else
  fail "Expo config principal divergente: name=${APP_NAME:-<vazio>} slug=${APP_SLUG:-<vazio>} version=${APP_VERSION:-<vazio>} runtime=${APP_RUNTIME_VERSION:-<vazio>}"
fi

if [[ "$UPDATES_ENABLED" == "false" ]]; then
  pass "Expo Updates desativado explicitamente"
elif [[ "$UPDATES_CHANNEL" == "production" ]]; then
  pass "Expo Updates usa canal production"
else
  fail "Expo Updates ativo sem requestHeaders expo-channel-name=production (encontrado: ${UPDATES_CHANNEL:-<vazio>})"
fi

if [[ "$ALLOW_HTTP" == "false" && "$LOCAL_NETWORKING" == "false" ]]; then
  pass "iOS ATS bloqueia HTTP inseguro"
else
  fail "iOS ATS permite HTTP inseguro (NSAllowsArbitraryLoads=$ALLOW_HTTP, NSAllowsLocalNetworking=$LOCAL_NETWORKING)"
fi

if [[ -n "$IOS_MICROPHONE_USAGE" ]]; then
  pass "iOS NSMicrophoneUsageDescription presente na config Expo"
else
  fail "iOS NSMicrophoneUsageDescription ausente na config Expo"
fi

if [[ ! -d "${ROOT_DIR}/ios" ]]; then
  pass "Diretório iOS nativo ausente; Expo prebuild aplicará purpose strings"
elif [[ -n "$NATIVE_IOS_MICROPHONE_USAGE" ]]; then
  pass "iOS NSMicrophoneUsageDescription presente no Info.plist nativo"
else
  fail "iOS NSMicrophoneUsageDescription ausente no Info.plist nativo"
fi

required_android_permissions=(
  android.permission.ACCESS_FINE_LOCATION
  android.permission.ACCESS_BACKGROUND_LOCATION
  android.permission.FOREGROUND_SERVICE_LOCATION
  android.permission.CAMERA
  android.permission.RECORD_AUDIO
)

for permission in "${required_android_permissions[@]}"; do
  if jq -r '.android.permissions[]?' "$TMP_PREBUILD_JSON" | rg -q "^${permission}$"; then
    pass "Permissão Android presente: $permission"
  else
    fail "Permissão Android ausente: $permission"
  fi
done

blocked_android_permissions=(
  android.permission.SYSTEM_ALERT_WINDOW
  android.permission.READ_EXTERNAL_STORAGE
  android.permission.WRITE_EXTERNAL_STORAGE
  android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK
)

for permission in "${blocked_android_permissions[@]}"; do
  if jq -r '.android.blockedPermissions[]?' "$TMP_PREBUILD_JSON" | rg -q "^${permission}$"; then
    pass "Permissão Android bloqueada: $permission"
  else
    fail "Permissão Android não está em blockedPermissions: $permission"
  fi
done

node - "$ANDROID_ICON" "$ANDROID_FOREGROUND" "$SPLASH_ANDROID" <<'NODE'
const fs = require('fs');
const path = require('path');

const expected = new Map([
  [process.argv[2], { width: 1024, height: 1024, label: 'android.icon' }],
  [process.argv[3], { width: 1024, height: 1024, label: 'android.adaptiveIcon.foregroundImage' }],
  [process.argv[4], { width: 1152, height: 1152, label: 'expo-splash-screen android.image' }]
]);

let failed = false;

for (const [relativePath, expectation] of expected.entries()) {
  const filePath = path.resolve(relativePath || '');
  if (!relativePath || !fs.existsSync(filePath)) {
    console.error(`[release-preflight][fail] asset ausente: ${expectation.label} (${relativePath || '<vazio>'})`);
    failed = true;
    continue;
  }

  const buffer = fs.readFileSync(filePath);
  const isPng = buffer.slice(1, 4).toString('ascii') === 'PNG';
  const width = isPng ? buffer.readUInt32BE(16) : 0;
  const height = isPng ? buffer.readUInt32BE(20) : 0;

  if (width === expectation.width && height === expectation.height) {
    console.log(`[release-preflight][pass] ${expectation.label}: ${width}x${height}`);
  } else {
    console.error(`[release-preflight][fail] ${expectation.label}: esperado ${expectation.width}x${expectation.height}, encontrado ${width}x${height}`);
    failed = true;
  }
}

process.exit(failed ? 2 : 0);
NODE

if [[ "$FAIL" -ne 0 ]]; then
  echo "[release-preflight] FAIL"
  exit 2
fi

echo "[release-preflight] PASS"
