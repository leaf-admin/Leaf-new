#!/usr/bin/env bash
set -euo pipefail

CORE_AUDIT_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_DIR="$(cd "${CORE_AUDIT_SCRIPT_DIR}/../.." && pwd)"
ROOT_DIR="$(cd "${MOBILE_DIR}/.." && pwd)"

# shellcheck source=/dev/null
source "${MOBILE_DIR}/scripts/source-local-build-env.sh"

BACKEND_URL="${BACKEND_URL:-https://api.62.169.31.231.sslip.io}"
APP_PACKAGE="${APP_PACKAGE:-br.com.leaf.ride}"
IOS_APP_ID="${IOS_APP_ID:-br.com.leaf.ride}"
IOS_APP_PATH="${IOS_APP_PATH:-${MOBILE_DIR}/ios/build/Build/Products/Release-iphonesimulator/Leaf.app}"
RUN_ANDROID="${RUN_ANDROID:-true}"
RUN_IOS="${RUN_IOS:-true}"
IOS_REINSTALL_APP="${IOS_REINSTALL_APP:-true}"
IOS_RESET_KEYCHAIN_BEFORE_AUTH="${IOS_RESET_KEYCHAIN_BEFORE_AUTH:-false}"
ADB_BIN="${ADB_BIN:-$(command -v adb || true)}"
ANDROID_SERIAL_ENV="${ANDROID_SERIAL:-}"
IOS_UDID_ENV="${IOS_UDID:-}"
ANDROID_CLEAR_APP_DATA_BEFORE_AUTH="${ANDROID_CLEAR_APP_DATA_BEFORE_AUTH:-false}"

export PATH="$PATH:$HOME/.maestro/bin"

if [[ -z "${ADB_BIN}" ]]; then
  for candidate in \
    "$ROOT_DIR/platform-tools/adb" \
    "$ROOT_DIR/android-sdk/platform-tools/adb" \
    "$HOME/Library/Android/sdk/platform-tools/adb" \
    "$HOME/Android/Sdk/platform-tools/adb"; do
    if [[ -x "$candidate" ]]; then
      ADB_BIN="$candidate"
      break
    fi
  done
fi

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
ARTIFACTS_DIR="${MOBILE_DIR}/.maestro/results/core_audit_${TIMESTAMP}"
mkdir -p "${ARTIFACTS_DIR}"/android "${ARTIFACTS_DIR}"/ios

ANDROID_FLOWS=(
  ".maestro/flows/auth/01-login-customer-real.yaml"
  ".maestro/flows/rides/01-request-ride-real.yaml"
  ".maestro/flows/qa/11-passenger-menu-support-settings-audit.yaml"
  ".maestro/flows/qa/12-passenger-rating-screen-audit.yaml"
)

IOS_FLOWS=(
  ".maestro/flows/auth/03-phone-otp-login-new-ios.yaml"
  ".maestro/flows/qa/11-passenger-menu-support-settings-audit.yaml"
  ".maestro/flows/qa/12-passenger-rating-screen-audit.yaml"
)

check_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[core-audit][error] Missing command: $1"
    exit 1
  fi
}

extract_case_time_seconds() {
  local xml_path="$1"
  if [[ ! -f "$xml_path" ]]; then
    echo "0"
    return 0
  fi

  local case_line
  case_line="$(grep -m1 "<testcase " "$xml_path" || true)"
  if [[ -z "$case_line" ]]; then
    echo "0"
    return 0
  fi

  local case_time
  case_time="$(echo "$case_line" | sed -n 's/.*time="\([0-9.]*\)".*/\1/p')"
  if [[ -z "$case_time" ]]; then
    case_time="0"
  fi
  echo "$case_time"
}

append_summary_row() {
  local platform="$1"
  local flow="$2"
  local status="$3"
  local time_seconds="$4"
  local xml_path="$5"
  local log_path="$6"
  printf "%s|%s|%s|%s|%s|%s\n" \
    "$platform" "$flow" "$status" "$time_seconds" "$xml_path" "$log_path" \
    >> "${ARTIFACTS_DIR}/summary.tsv"
}

bring_leaf_foreground_android() {
  "$ADB_BIN" shell am force-stop com.google.android.apps.maps >/dev/null 2>&1 || true
  "$ADB_BIN" shell am start -W -n br.com.leaf.ride/.MainActivity >/dev/null 2>&1 \
    || "$ADB_BIN" shell monkey -p "$APP_PACKAGE" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
}

prepare_android_flow_runtime() {
  local flow_path="$1"

  if [[ "$flow_path" == *"/auth/"* ]] && [[ "$ANDROID_CLEAR_APP_DATA_BEFORE_AUTH" == "true" ]]; then
    echo "[core-audit] Android clear app data before auth flow..."
    "$ADB_BIN" shell pm clear "$APP_PACKAGE" >/dev/null 2>&1 || true
    sleep 1
  fi

  bring_leaf_foreground_android
  sleep 2
}

prepare_ios_runtime() {
  if [[ "$IOS_REINSTALL_APP" != "true" ]]; then
    return 0
  fi

  if [[ ! -d "$IOS_APP_PATH" ]]; then
    echo "[core-audit][warn] iOS app bundle not found at $IOS_APP_PATH (skipping reinstall)."
    return 0
  fi

  xcrun simctl terminate "$IOS_UDID_ENV" "$IOS_APP_ID" >/dev/null 2>&1 || true
  xcrun simctl uninstall "$IOS_UDID_ENV" "$IOS_APP_ID" >/dev/null 2>&1 || true
  xcrun simctl install "$IOS_UDID_ENV" "$IOS_APP_PATH"
}

prepare_ios_flow_runtime() {
  local flow_path="$1"

  if [[ "$flow_path" == *"/auth/"* ]] && [[ "$IOS_RESET_KEYCHAIN_BEFORE_AUTH" == "true" ]]; then
    xcrun simctl keychain "$IOS_UDID_ENV" reset
  fi
}

run_maestro_flow() {
  local platform="$1"
  local device="$2"
  local flow="$3"
  local out_dir="$4"
  local flow_name
  flow_name="$(basename "$flow" .yaml)"
  local log_path="${out_dir}/${flow_name}.log"
  local xml_path="${out_dir}/${flow_name}.xml"
  local test_output_dir="${out_dir}/test-output-${flow_name}"
  local debug_output_dir="${out_dir}/debug-${flow_name}"

  echo "[core-audit] Running ${platform} flow: ${flow}"

  if maestro test "$flow" \
    --format junit \
    --output "$xml_path" \
    --test-output-dir "$test_output_dir" \
    --debug-output "$debug_output_dir" \
    --device "$device" \
    --no-reinstall-driver > "$log_path" 2>&1; then
    local time_s
    time_s="$(extract_case_time_seconds "$xml_path")"
    append_summary_row "$platform" "$flow" "PASS" "$time_s" "$xml_path" "$log_path"
    echo "[core-audit] PASS ${flow_name} (${time_s}s)"
    return 0
  else
    local time_s
    time_s="$(extract_case_time_seconds "$xml_path")"
    append_summary_row "$platform" "$flow" "FAIL" "$time_s" "$xml_path" "$log_path"
    echo "[core-audit] FAIL ${flow_name} (${time_s}s)"
    return 1
  fi
}

summarize_results() {
  local total=0
  local pass=0
  local fail=0

  while IFS='|' read -r _ _ status _ _ _; do
    [[ -z "${status}" ]] && continue
    [[ "${status}" == "status" ]] && continue
    total=$((total + 1))
    if [[ "$status" == "PASS" ]]; then
      pass=$((pass + 1))
    else
      fail=$((fail + 1))
    fi
  done < "${ARTIFACTS_DIR}/summary.tsv"

  {
    echo "timestamp=${TIMESTAMP}"
    echo "backend_url=${BACKEND_URL}"
    echo "total=${total}"
    echo "pass=${pass}"
    echo "fail=${fail}"
  } > "${ARTIFACTS_DIR}/totals.txt"
}

check_cmd curl
check_cmd maestro

if [[ "$RUN_ANDROID" == "true" ]] && [[ -z "$ADB_BIN" ]]; then
  echo "[core-audit][error] adb not found."
  exit 1
fi

if [[ "$RUN_IOS" == "true" ]]; then
  check_cmd xcrun
fi

echo "[core-audit] artifacts: ${ARTIFACTS_DIR}"
echo "[core-audit] backend: ${BACKEND_URL}"

curl -sS --max-time 12 "$BACKEND_URL/health" > "${ARTIFACTS_DIR}/backend-health.json"
curl -sS --max-time 12 "$BACKEND_URL/socket.io/?EIO=4&transport=polling" > "${ARTIFACTS_DIR}/backend-socketio-handshake.txt"
bash "${CORE_AUDIT_SCRIPT_DIR}/assert-backend-real-sandbox.sh" "$BACKEND_URL" "${ARTIFACTS_DIR}/backend-runtime-flags.json"

echo "platform|flow|status|time_seconds|xml|log" > "${ARTIFACTS_DIR}/summary.tsv"

FAIL_COUNT=0

if [[ "$RUN_ANDROID" == "true" ]]; then
  if ! "$ADB_BIN" get-state >/dev/null 2>&1; then
    echo "[core-audit][error] No Android device connected via adb."
    exit 1
  fi

  if ! "$ADB_BIN" shell pm list packages | grep -q "$APP_PACKAGE"; then
    echo "[core-audit][error] Android package not installed: ${APP_PACKAGE}"
    exit 1
  fi

  if [[ -z "$ANDROID_SERIAL_ENV" ]]; then
    ANDROID_SERIAL_ENV="$("$ADB_BIN" devices | awk 'NR>1 && $2=="device" {print $1; exit}')"
  fi
  if [[ -z "$ANDROID_SERIAL_ENV" ]]; then
    echo "[core-audit][error] Could not resolve ANDROID_SERIAL."
    exit 1
  fi
  export ANDROID_SERIAL="$ANDROID_SERIAL_ENV"
  echo "[core-audit] android_serial: ${ANDROID_SERIAL}"

  for flow in "${ANDROID_FLOWS[@]}"; do
    prepare_android_flow_runtime "$flow"
    if ! run_maestro_flow "android" "$ANDROID_SERIAL" "$flow" "${ARTIFACTS_DIR}/android"; then
      FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
  done
fi

if [[ "$RUN_IOS" == "true" ]]; then
  if [[ -z "$IOS_UDID_ENV" ]]; then
    IOS_UDID_ENV="$(xcrun simctl list devices | awk -F '[()]' '/Booted/ && /iPhone/ {print $2; exit}')"
  fi

  if [[ -z "$IOS_UDID_ENV" ]]; then
    IOS_UDID_ENV="$(xcrun simctl list devices | awk -F '[()]' '/iPhone 17 Pro/ && /Shutdown/ {print $2; exit}')"
    if [[ -z "$IOS_UDID_ENV" ]]; then
      IOS_UDID_ENV="$(xcrun simctl list devices | awk -F '[()]' '/iPhone/ && /Shutdown/ {print $2; exit}')"
    fi
    if [[ -n "$IOS_UDID_ENV" ]]; then
      echo "[core-audit] Booting iOS simulator: ${IOS_UDID_ENV}"
      xcrun simctl boot "$IOS_UDID_ENV" >/dev/null 2>&1 || true
      sleep 5
    fi
  fi

  if [[ -z "$IOS_UDID_ENV" ]]; then
    echo "[core-audit][error] No booted iOS simulator found."
    exit 1
  fi
  echo "[core-audit] ios_udid: ${IOS_UDID_ENV}"

  prepare_ios_runtime

  for flow in "${IOS_FLOWS[@]}"; do
    prepare_ios_flow_runtime "$flow"
    if ! run_maestro_flow "ios" "$IOS_UDID_ENV" "$flow" "${ARTIFACTS_DIR}/ios"; then
      FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
  done
fi

summarize_results

echo "[core-audit] Summary:"
cat "${ARTIFACTS_DIR}/totals.txt"

if [[ "$FAIL_COUNT" -gt 0 ]]; then
  exit 2
fi
