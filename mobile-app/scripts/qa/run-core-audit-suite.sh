#!/usr/bin/env bash
set -euo pipefail

CORE_AUDIT_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_DIR="$(cd "${CORE_AUDIT_SCRIPT_DIR}/../.." && pwd)"
ROOT_DIR="$(cd "${MOBILE_DIR}/.." && pwd)"

# shellcheck source=/dev/null
source "${MOBILE_DIR}/scripts/source-local-build-env.sh"

BACKEND_URL="${BACKEND_URL:-https://api.leaf.app.br}"
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
RELEASE_ONLY="${RELEASE_ONLY:-true}"
MAESTRO_MIN_VERSION="${MAESTRO_MIN_VERSION:-2.5.0}"
MAESTRO_DRIVER_STARTUP_TIMEOUT="${MAESTRO_DRIVER_STARTUP_TIMEOUT:-60000}"
MAESTRO_ANDROID_FLOW_RETRIES="${MAESTRO_ANDROID_FLOW_RETRIES:-2}"
ANDROID_BOOT_TIMEOUT_SECONDS="${ANDROID_BOOT_TIMEOUT_SECONDS:-240}"
LEAF_QA_LOCATION_LAT="${LEAF_QA_LOCATION_LAT:--22.971964}"
LEAF_QA_LOCATION_LNG="${LEAF_QA_LOCATION_LNG:--43.182543}"

export PATH="$PATH:$HOME/.maestro/bin"
export MAESTRO_DRIVER_STARTUP_TIMEOUT

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
  ".maestro/flows/auth/02-login-driver.yaml"
  ".maestro/flows/driver/01-driver-go-online.yaml"
  ".maestro/flows/auth/01-login-customer-real.yaml"
  ".maestro/flows/rides/01-request-ride-real.yaml"
  ".maestro/flows/qa/11-passenger-menu-support-settings-audit.yaml"
  ".maestro/flows/qa/12-passenger-rating-screen-audit.yaml"
)

IOS_FLOWS=(
  ".maestro/flows/auth/04-phone-driver-home-online-ios.yaml"
  ".maestro/flows/auth/03-phone-otp-login-new-ios.yaml"
  ".maestro/flows/rides/01-request-ride-real.yaml"
  ".maestro/flows/qa/11-passenger-menu-support-settings-audit.yaml"
  ".maestro/flows/qa/12-passenger-rating-screen-audit.yaml"
)

check_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[core-audit][error] Missing command: $1"
    exit 1
  fi
}

sanitize_semver() {
  local raw="$1"
  raw="${raw#v}"
  raw="${raw%%-*}"
  printf "%s" "$raw"
}

semver_ge() {
  local current target i
  current="$(sanitize_semver "$1")"
  target="$(sanitize_semver "$2")"

  local current_parts=(0 0 0)
  local target_parts=(0 0 0)
  IFS='.' read -r -a current_parts <<<"$current"
  IFS='.' read -r -a target_parts <<<"$target"

  for i in 0 1 2; do
    local c="${current_parts[$i]:-0}"
    local t="${target_parts[$i]:-0}"
    c="${c//[^0-9]/}"
    t="${t//[^0-9]/}"
    c="${c:-0}"
    t="${t:-0}"
    if ((c > t)); then
      return 0
    fi
    if ((c < t)); then
      return 1
    fi
  done
  return 0
}

assert_maestro_version() {
  local current
  current="$(maestro --version 2>/dev/null | head -n1 | tr -d '\r' | tr -d '\n')"
  if [[ -z "$current" ]]; then
    echo "[core-audit][error] Could not detect Maestro version."
    exit 1
  fi

  if ! semver_ge "$current" "$MAESTRO_MIN_VERSION"; then
    echo "[core-audit][error] Maestro ${current} is too old for stable Android smoke."
    echo "[core-audit][error] Required version: >= ${MAESTRO_MIN_VERSION}"
    echo "[core-audit][hint] Upgrade command: curl -Ls \"https://get.maestro.mobile.dev\" | bash"
    exit 1
  fi

  echo "[core-audit] maestro_version: ${current}"
}

write_release_preconditions() {
  {
    echo "# Core Audit Release Preconditions"
    echo
    echo "timestamp=${TIMESTAMP}"
    echo "release_only=${RELEASE_ONLY}"
    echo "backend_url=${BACKEND_URL}"
    echo "app_package=${APP_PACKAGE}"
    echo "ios_app_id=${IOS_APP_ID}"
    echo "ios_app_path=${IOS_APP_PATH}"
    echo
    echo "1. Use only installed release build for ${APP_PACKAGE}; debug/dev-client builds are blockers."
    echo "2. Backend /health/runtime-flags must report realSandbox.ready=true."
    echo "3. Payment mock/bypass markers are forbidden in runtime flags and release suite flow files."
    echo "4. Driver login/online flow runs before passenger login/request flow."
    echo "5. Expected evidence per round: backend-health.json, backend-runtime-flags.json, socket handshake, JUnit XML, Maestro logs, debug/test-output folders, summary.tsv and totals.txt."
    echo
    echo "Release suite order:"
    printf "android:%s\n" "${ANDROID_FLOWS[@]}"
    printf "ios:%s\n" "${IOS_FLOWS[@]}"
  } > "${ARTIFACTS_DIR}/release-preconditions.md"
}

assert_flow_release_contract() {
  local flow="$1"
  if [[ "${RELEASE_ONLY}" != "true" ]]; then
    return 0
  fi
  if [[ ! -f "${MOBILE_DIR}/${flow}" ]]; then
    echo "[core-audit][error] Flow not found: ${flow}"
    exit 1
  fi
  if rg -ni "payment[-_[:space:]]?bypass|PaymentBypassService|E2E_TEST[[:space:]]*=[[:space:]]*true|mockPayment|paymentMock|mock-payment|pagamento.*mock|mock.*pagamento" "${MOBILE_DIR}/${flow}" >/dev/null; then
    echo "[core-audit][error] Release-only flow contains payment mock/bypass marker: ${flow}"
    rg -ni "payment[-_[:space:]]?bypass|PaymentBypassService|E2E_TEST[[:space:]]*=[[:space:]]*true|mockPayment|paymentMock|mock-payment|pagamento.*mock|mock.*pagamento" "${MOBILE_DIR}/${flow}" || true
    exit 1
  fi
}

assert_release_flow_contracts() {
  local flow
  for flow in "${ANDROID_FLOWS[@]}" "${IOS_FLOWS[@]}"; do
    assert_flow_release_contract "$flow"
  done
}

assert_backend_no_payment_bypass() {
  local flags_file="$1"
  if [[ "${RELEASE_ONLY}" != "true" ]]; then
    return 0
  fi

  if jq -e '
    [
      paths(scalars) as $p
      | {
          key: ($p | map(tostring) | join(".")),
          value: getpath($p)
        }
      | select((.key | test("payment.*(mock|bypass)|(mock|bypass).*payment|PaymentBypass|testAuthBypass|E2E_TEST"; "i"))
          and ((.value == true) or (.value == "true") or (.value == 1) or (.value == "1")))
    ] | length > 0
  ' "$flags_file" >/dev/null; then
    echo "[core-audit][error] Runtime flags expose enabled payment mock/bypass markers."
    jq '
      [
        paths(scalars) as $p
        | {
            key: ($p | map(tostring) | join(".")),
            value: getpath($p)
          }
        | select((.key | test("payment.*(mock|bypass)|(mock|bypass).*payment|PaymentBypass|testAuthBypass|E2E_TEST"; "i"))
            and ((.value == true) or (.value == "true") or (.value == 1) or (.value == "1")))
      ]
    ' "$flags_file"
    exit 1
  fi
}

assert_android_release_build() {
  local serial="$1"
  if [[ "${RELEASE_ONLY}" != "true" ]]; then
    return 0
  fi

  local dump_path="${ARTIFACTS_DIR}/android-package-dump.txt"
  "$ADB_BIN" -s "$serial" shell dumpsys package "$APP_PACKAGE" > "$dump_path" 2>/dev/null || true
  if rg -q "DEBUGGABLE" "$dump_path"; then
    echo "[core-audit][error] Android installed package is debuggable; release-only suite requires a release build."
    echo "[core-audit][error] Package dump: ${dump_path}"
    exit 1
  fi
  echo "[core-audit] android_release_build: ok"
}

assert_ios_release_build() {
  if [[ "${RELEASE_ONLY}" != "true" || "${RUN_IOS}" != "true" ]]; then
    return 0
  fi
  if [[ "${IOS_REINSTALL_APP}" == "true" ]]; then
    if [[ "${IOS_APP_PATH}" != *"/Release-iphonesimulator/"* ]]; then
      echo "[core-audit][error] IOS_APP_PATH must point to Release-iphonesimulator for release-only suite: ${IOS_APP_PATH}"
      exit 1
    fi
    if [[ ! -d "${IOS_APP_PATH}" ]]; then
      echo "[core-audit][error] iOS release app bundle not found: ${IOS_APP_PATH}"
      exit 1
    fi
  fi
  echo "[core-audit] ios_release_build: ok"
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
  "$ADB_BIN" -s "$ANDROID_SERIAL" shell am force-stop com.google.android.apps.maps >/dev/null 2>&1 || true
  "$ADB_BIN" -s "$ANDROID_SERIAL" shell am start -W -n br.com.leaf.ride/.MainActivity >/dev/null 2>&1 \
    || "$ADB_BIN" -s "$ANDROID_SERIAL" shell monkey -p "$APP_PACKAGE" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
}

wait_for_android_boot() {
  local serial="$1"
  local elapsed=0

  "$ADB_BIN" -s "$serial" wait-for-device >/dev/null 2>&1

  while ((elapsed < ANDROID_BOOT_TIMEOUT_SECONDS)); do
    local boot_completed
    boot_completed="$("$ADB_BIN" -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' | tr -d '\n' || true)"
    if [[ "$boot_completed" == "1" ]]; then
      "$ADB_BIN" -s "$serial" shell input keyevent 82 >/dev/null 2>&1 || true
      "$ADB_BIN" -s "$serial" shell wm dismiss-keyguard >/dev/null 2>&1 || true
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done

  return 1
}

disable_android_animations() {
  local serial="$1"
  "$ADB_BIN" -s "$serial" shell settings put global window_animation_scale 0 >/dev/null 2>&1 || true
  "$ADB_BIN" -s "$serial" shell settings put global transition_animation_scale 0 >/dev/null 2>&1 || true
  "$ADB_BIN" -s "$serial" shell settings put global animator_duration_scale 0 >/dev/null 2>&1 || true
}

set_android_location() {
  local serial="$1"
  "$ADB_BIN" -s "$serial" emu geo fix "${LEAF_QA_LOCATION_LNG}" "${LEAF_QA_LOCATION_LAT}" >/dev/null 2>&1 || true
}

set_ios_location() {
  local udid="$1"
  xcrun simctl location "$udid" set "${LEAF_QA_LOCATION_LAT},${LEAF_QA_LOCATION_LNG}" >/dev/null 2>&1 || true
}

kill_stale_maestro_processes() {
  pkill -f "maestro.cli.AppKt test" >/dev/null 2>&1 || true
}

recover_android_transport() {
  local flow="$1"
  echo "[core-audit][warn] Recovering Android transport for flow: $flow"
  kill_stale_maestro_processes
  "$ADB_BIN" kill-server >/dev/null 2>&1 || true
  sleep 1
  "$ADB_BIN" start-server >/dev/null 2>&1 || true
  "$ADB_BIN" -s "$ANDROID_SERIAL" wait-for-device >/dev/null 2>&1 || true
  wait_for_android_boot "$ANDROID_SERIAL" || true
  disable_android_animations "$ANDROID_SERIAL"
  set_android_location "$ANDROID_SERIAL"
  "$ADB_BIN" -s "$ANDROID_SERIAL" reverse --remove-all >/dev/null 2>&1 || true
  "$ADB_BIN" -s "$ANDROID_SERIAL" forward --remove-all >/dev/null 2>&1 || true
  "$ADB_BIN" -s "$ANDROID_SERIAL" shell am force-stop "$APP_PACKAGE" >/dev/null 2>&1 || true
  sleep 2
}

prepare_android_flow_runtime() {
  local flow_path="$1"

  if [[ "$flow_path" == *"/auth/"* ]] && [[ "$ANDROID_CLEAR_APP_DATA_BEFORE_AUTH" == "true" ]]; then
    echo "[core-audit] Android clear app data before auth flow..."
    "$ADB_BIN" -s "$ANDROID_SERIAL" shell pm clear "$APP_PACKAGE" >/dev/null 2>&1 || true
    sleep 1
  fi

  disable_android_animations "$ANDROID_SERIAL"
  set_android_location "$ANDROID_SERIAL"
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

  set_ios_location "$IOS_UDID_ENV"
  xcrun simctl terminate "$IOS_UDID_ENV" "$IOS_APP_ID" >/dev/null 2>&1 || true
  xcrun simctl uninstall "$IOS_UDID_ENV" "$IOS_APP_ID" >/dev/null 2>&1 || true
  xcrun simctl install "$IOS_UDID_ENV" "$IOS_APP_PATH"
  set_ios_location "$IOS_UDID_ENV"
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
    --device "$device" > "$log_path" 2>&1; then
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

is_android_transport_failure() {
  local log_path="$1"
  if [[ ! -f "$log_path" ]]; then
    return 1
  fi
  rg -q "DEADLINE_EXCEEDED|UNAVAILABLE: io exception|driver did not start up in time|Unable to launch app|localhost/127\\.0\\.0\\.1:7001" "$log_path"
}

run_android_flow_with_retries() {
  local flow="$1"
  local attempt=1

  while ((attempt <= MAESTRO_ANDROID_FLOW_RETRIES)); do
    prepare_android_flow_runtime "$flow"
    if run_maestro_flow "android" "$ANDROID_SERIAL" "$flow" "${ARTIFACTS_DIR}/android"; then
      return 0
    fi

    local flow_name
    flow_name="$(basename "$flow" .yaml)"
    local log_path="${ARTIFACTS_DIR}/android/${flow_name}.log"

    if ((attempt < MAESTRO_ANDROID_FLOW_RETRIES)) && is_android_transport_failure "$log_path"; then
      recover_android_transport "$flow"
      attempt=$((attempt + 1))
      continue
    fi

    return 1
  done

  return 1
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
check_cmd rg
assert_maestro_version

if [[ "$RUN_ANDROID" == "true" ]] && [[ -z "$ADB_BIN" ]]; then
  echo "[core-audit][error] adb not found."
  exit 1
fi

if [[ "$RUN_IOS" == "true" ]]; then
  check_cmd xcrun
fi

echo "[core-audit] artifacts: ${ARTIFACTS_DIR}"
echo "[core-audit] backend: ${BACKEND_URL}"
write_release_preconditions
assert_release_flow_contracts

curl -sS --max-time 12 "$BACKEND_URL/health" > "${ARTIFACTS_DIR}/backend-health.json"
curl -sS --max-time 12 "$BACKEND_URL/socket.io/?EIO=4&transport=polling" > "${ARTIFACTS_DIR}/backend-socketio-handshake.txt"
bash "${CORE_AUDIT_SCRIPT_DIR}/assert-backend-real-sandbox.sh" "$BACKEND_URL" "${ARTIFACTS_DIR}/backend-runtime-flags.json"
assert_backend_no_payment_bypass "${ARTIFACTS_DIR}/backend-runtime-flags.json"

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
  if ! wait_for_android_boot "$ANDROID_SERIAL"; then
    echo "[core-audit][error] Android device did not finish boot in ${ANDROID_BOOT_TIMEOUT_SECONDS}s."
    exit 1
  fi
  disable_android_animations "$ANDROID_SERIAL"
  set_android_location "$ANDROID_SERIAL"
  assert_android_release_build "$ANDROID_SERIAL"

  for flow in "${ANDROID_FLOWS[@]}"; do
    if ! run_android_flow_with_retries "$flow"; then
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
  set_ios_location "$IOS_UDID_ENV"
  assert_ios_release_build

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
