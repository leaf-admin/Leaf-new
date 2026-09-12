#!/usr/bin/env bash
set -euo pipefail

QA_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_DIR="$(cd "${QA_SCRIPT_DIR}/../.." && pwd)"

if [[ -f "${MOBILE_DIR}/scripts/source-local-build-env.sh" ]]; then
  # shellcheck source=/dev/null
  source "${MOBILE_DIR}/scripts/source-local-build-env.sh"
fi

APP_PACKAGE="${APP_PACKAGE:-br.com.leaf.ride}"
PASSENGER_RUNTIME="${PASSENGER_RUNTIME:-android_device}"
DRIVER_RUNTIME="${DRIVER_RUNTIME:-android_emulator}"
PASSENGER_AVD="${PASSENGER_AVD:-Leaf_API_35}"
DRIVER_AVD="${DRIVER_AVD:-Leaf_API_35_Driver}"
START_DRIVER_EMULATOR="${START_DRIVER_EMULATOR:-false}"
REQUIRE_RUNNING_ANDROID_EMULATOR="${REQUIRE_RUNNING_ANDROID_EMULATOR:-true}"
REQUIRE_RUNNING_ANDROID_APP="${REQUIRE_RUNNING_ANDROID_APP:-true}"
REQUIRE_MATCHING_ANDROID_APP_VERSION="${REQUIRE_MATCHING_ANDROID_APP_VERSION:-true}"
FORCE_INSTALL_DRIVER_APK="${FORCE_INSTALL_DRIVER_APK:-false}"
ANDROID_PASSENGER_SERIAL="${ANDROID_PASSENGER_SERIAL:-}"
ANDROID_DRIVER_SERIAL="${ANDROID_DRIVER_SERIAL:-}"
ANDROID_DRIVER_APK="${ANDROID_DRIVER_APK:-}"
ADB_BIN="${ADB_BIN:-${ANDROID_SDK_ROOT:-${HOME}/Android/Sdk}/platform-tools/adb}"
EMULATOR_BIN="${EMULATOR_BIN:-${ANDROID_SDK_ROOT:-${HOME}/Android/Sdk}/emulator/emulator}"
OUTPUT_DIR="${OUTPUT_DIR:-${MOBILE_DIR}/test-results/android-role-runtime-$(date -u +%Y%m%dT%H%M%SZ)}"
BOOT_TIMEOUT_SECONDS="${ANDROID_EMULATOR_BOOT_TIMEOUT_SECONDS:-240}"
EMULATOR_STABILITY_SECONDS="${ANDROID_EMULATOR_STABILITY_SECONDS:-60}"

mkdir -p "${OUTPUT_DIR}"

log() {
  printf '[android-role-runtimes] %s\n' "$*" >&2
}

fail() {
  printf '[android-role-runtimes][error] %s\n' "$*" >&2
  exit 1
}

normalize_runtime() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9_' '_'
}

require_file() {
  [[ -x "$1" || -f "$1" ]] || fail "Missing file: $1"
}

first_physical_android_serial() {
  "${ADB_BIN}" devices | awk 'NR > 1 && $1 !~ /^emulator-/ && $2 == "device" { print $1; exit }'
}

first_emulator_serial() {
  "${ADB_BIN}" devices | awk 'NR > 1 && $1 ~ /^emulator-/ && $2 == "device" { print $1; exit }'
}

required_avd_for_emulator_role() {
  if [[ "${PASSENGER_RUNTIME}" == "android_emulator" ]]; then
    printf '%s' "${PASSENGER_AVD}"
  elif [[ "${DRIVER_RUNTIME}" == "android_emulator" ]]; then
    printf '%s' "${DRIVER_AVD}"
  fi
}

wait_for_boot() {
  local serial="$1"
  local deadline=$((SECONDS + BOOT_TIMEOUT_SECONDS))
  "${ADB_BIN}" -s "${serial}" wait-for-device >/dev/null
  while (( SECONDS < deadline )); do
    local boot_completed
    boot_completed="$("${ADB_BIN}" -s "${serial}" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')"
    if [[ "${boot_completed}" == "1" ]]; then
      return 0
    fi
    sleep 2
  done
  return 1
}

verify_emulator_stability() {
  local serial="$1"
  local stability_seconds="$2"
  local deadline

  [[ -n "${serial}" ]] || return 1
  if ! [[ "${stability_seconds}" =~ ^[0-9]+$ ]]; then
    stability_seconds=60
  fi
  if (( stability_seconds <= 0 )); then
    return 0
  fi

  deadline=$((SECONDS + stability_seconds))
  while (( SECONDS < deadline )); do
    if ! "${ADB_BIN}" -s "${serial}" get-state >/dev/null 2>&1; then
      "${ADB_BIN}" devices -l > "${OUTPUT_DIR}/adb-devices-after-emulator-drop.txt" 2>&1 || true
      return 1
    fi
    sleep 2
  done

  "${ADB_BIN}" devices -l > "${OUTPUT_DIR}/adb-devices-after-emulator-stability.txt" 2>&1 || true
  return 0
}

start_or_find_emulator() {
  local serial
  serial="$(first_emulator_serial)"
  if [[ -n "${serial}" ]]; then
    printf '%s' "${serial}"
    return 0
  fi

  if [[ "${START_DRIVER_EMULATOR}" != "true" ]]; then
    return 1
  fi

  local required_avd
  required_avd="$(required_avd_for_emulator_role)"
  [[ -n "${required_avd}" ]] || fail "blocked_precondition:android_role_pair_not_ready emulator role is missing an AVD name"
  require_file "${EMULATOR_BIN}"
  if ! "${EMULATOR_BIN}" -list-avds | grep -qx "${required_avd}"; then
    "${EMULATOR_BIN}" -list-avds > "${OUTPUT_DIR}/android-avds.txt" 2>&1 || true
    fail "blocked_precondition:android_role_pair_not_ready required AVD not found: ${required_avd}"
  fi

  log "starting ${required_avd}"
  nohup "${EMULATOR_BIN}" -avd "${required_avd}" -no-snapshot-load -no-audio -no-boot-anim \
    > "${OUTPUT_DIR}/driver-emulator.log" 2>&1 &

  local deadline=$((SECONDS + BOOT_TIMEOUT_SECONDS))
  while (( SECONDS < deadline )); do
    serial="$(first_emulator_serial)"
    if [[ -n "${serial}" ]]; then
      printf '%s' "${serial}"
      return 0
    fi
    sleep 2
  done
  return 1
}

verify_package_on_serial() {
  local serial="$1"
  local role="$2"
  local package_list

  if [[ "${role}" == "driver" && "${FORCE_INSTALL_DRIVER_APK}" == "true" ]]; then
    [[ -n "${ANDROID_DRIVER_APK}" ]] || fail "FORCE_INSTALL_DRIVER_APK=true requires ANDROID_DRIVER_APK"
    [[ -f "${ANDROID_DRIVER_APK}" ]] || fail "ANDROID_DRIVER_APK does not exist: ${ANDROID_DRIVER_APK}"
    "${ADB_BIN}" -s "${serial}" install -r "${ANDROID_DRIVER_APK}"
  fi

  package_list="$("${ADB_BIN}" -s "${serial}" shell pm list packages "${APP_PACKAGE}" 2>/dev/null || true)"
  printf '%s\n' "${package_list}" > "${OUTPUT_DIR}/android-${role}-runtime-package-list.txt"

  if [[ "${package_list}" != *"${APP_PACKAGE}"* ]]; then
    fail "blocked_precondition:android_role_pair_not_ready ${APP_PACKAGE} is not installed on ${role} runtime ${serial}; install explicitly or set FORCE_INSTALL_DRIVER_APK=true for the driver"
  fi

  local version_file="${OUTPUT_DIR}/android-${role}-runtime-app-version.txt"
  "${ADB_BIN}" -s "${serial}" shell dumpsys package "${APP_PACKAGE}" \
    | rg 'versionName|versionCode|firstInstallTime|lastUpdateTime' \
    | tee "${version_file}" >/dev/null

  local version_code
  local version_name
  version_code="$(sed -n 's/.*versionCode=\([0-9][0-9]*\).*/\1/p' "${version_file}" | head -n 1)"
  version_name="$(sed -n 's/.*versionName=\([^[:space:]]*\).*/\1/p' "${version_file}" | head -n 1)"
  {
    printf 'VERSION_CODE=%s\n' "${version_code}"
    printf 'VERSION_NAME=%s\n' "${version_name}"
  } > "${OUTPUT_DIR}/android-${role}-runtime-version.env"
}

verify_app_boot_on_serial() {
  local serial="$1"
  local role="$2"
  local activity_dump
  local resumed_line
  local ui_dump
  local remote_ui_path="/sdcard/leaf-qa-${role}-ui.xml"

  activity_dump="$("${ADB_BIN}" -s "${serial}" shell dumpsys activity activities 2>/dev/null | tr -d '\r' || true)"
  printf '%s\n' "${activity_dump}" > "${OUTPUT_DIR}/android-${role}-runtime-activity.txt"
  resumed_line="$(printf '%s\n' "${activity_dump}" | rg '(mResumedActivity|ResumedActivity)' | head -n 1 || true)"
  if [[ "${resumed_line}" != *"${APP_PACKAGE}/"*"MainActivity"* ]]; then
    fail "blocked_precondition:android_role_app_not_booted ${role} app must have ${APP_PACKAGE}/.MainActivity resumed before the scenario"
  fi

  "${ADB_BIN}" -s "${serial}" shell rm -f "${remote_ui_path}" >/dev/null 2>&1 || true
  "${ADB_BIN}" -s "${serial}" shell uiautomator dump "${remote_ui_path}" >/dev/null 2>&1 || true
  ui_dump="$("${ADB_BIN}" -s "${serial}" shell cat "${remote_ui_path}" 2>/dev/null | tr -d '\r' || true)"
  "${ADB_BIN}" -s "${serial}" shell rm -f "${remote_ui_path}" >/dev/null 2>&1 || true
  printf '%s\n' "${ui_dump}" > "${OUTPUT_DIR}/android-${role}-runtime-ui.txt"
  if printf '%s\n' "${ui_dump}" | rg -qi 'Sessão encerrada|Session ended|opened in another device|aberta em outro aparelho'; then
    fail "blocked_precondition:android_role_session_not_ready ${role} app has an ended-session dialog; re-establish the single real app session before the scenario"
  fi
}

require_file "${ADB_BIN}"
PASSENGER_RUNTIME="$(normalize_runtime "${PASSENGER_RUNTIME}")"
DRIVER_RUNTIME="$(normalize_runtime "${DRIVER_RUNTIME}")"

if [[ "${PASSENGER_RUNTIME}" == "${DRIVER_RUNTIME}" ]]; then
  fail "blocked_precondition:android_role_pair_not_ready passenger and driver runtime must be distinct"
fi
if [[ " ${PASSENGER_RUNTIME} ${DRIVER_RUNTIME} " != *" android_device "* ]]; then
  fail "blocked_precondition:android_role_pair_not_ready one role must run on the connected Android device"
fi
if [[ " ${PASSENGER_RUNTIME} ${DRIVER_RUNTIME} " != *" android_emulator "* ]]; then
  fail "blocked_precondition:android_role_pair_not_ready one role must run on an Android emulator"
fi

"${ADB_BIN}" devices -l > "${OUTPUT_DIR}/adb-devices.txt"

physical_serial="$(first_physical_android_serial)"
if [[ -z "${physical_serial}" ]]; then
  fail "blocked_precondition:device_not_ready connected Android device serial is not resolved"
fi

emulator_serial="$(start_or_find_emulator || true)"
if [[ -z "${emulator_serial}" && "${REQUIRE_RUNNING_ANDROID_EMULATOR}" == "true" ]]; then
  fail "blocked_precondition:android_role_pair_not_ready Android emulator is not running"
fi
if [[ -n "${emulator_serial}" ]] && ! wait_for_boot "${emulator_serial}"; then
  fail "blocked_precondition:android_role_pair_not_ready Android emulator did not finish booting"
fi
if [[ -n "${emulator_serial}" ]] && ! verify_emulator_stability "${emulator_serial}" "${EMULATOR_STABILITY_SECONDS}"; then
  fail "blocked_precondition:android_role_pair_not_ready Android emulator did not remain connected for ${EMULATOR_STABILITY_SECONDS}s"
fi

if [[ "${PASSENGER_RUNTIME}" == "android_device" ]]; then
  passenger_serial="${ANDROID_PASSENGER_SERIAL:-${physical_serial}}"
else
  passenger_serial="${ANDROID_PASSENGER_SERIAL:-${emulator_serial}}"
fi

if [[ "${DRIVER_RUNTIME}" == "android_device" ]]; then
  driver_serial="${ANDROID_DRIVER_SERIAL:-${physical_serial}}"
else
  driver_serial="${ANDROID_DRIVER_SERIAL:-${emulator_serial}}"
fi

if [[ -z "${passenger_serial}" || -z "${driver_serial}" ]]; then
  fail "blocked_precondition:android_role_pair_not_ready passenger and driver serials must both be resolved before L2 smoke"
fi
if [[ "${passenger_serial}" == "${driver_serial}" ]]; then
  fail "blocked_precondition:android_role_pair_not_ready passenger and driver must not share the same Android runtime"
fi
if [[ "${PASSENGER_RUNTIME}" == "android_device" && "${passenger_serial}" == emulator-* ]]; then
  fail "blocked_precondition:android_role_pair_not_ready passenger physical device serial must not be an emulator"
fi
if [[ "${DRIVER_RUNTIME}" == "android_device" && "${driver_serial}" == emulator-* ]]; then
  fail "blocked_precondition:android_role_pair_not_ready driver physical device serial must not be an emulator"
fi

verify_package_on_serial "${passenger_serial}" "passenger"
verify_package_on_serial "${driver_serial}" "driver"

passenger_app_booted=null
driver_app_booted=null
if [[ "${REQUIRE_RUNNING_ANDROID_APP}" == "true" ]]; then
  verify_app_boot_on_serial "${passenger_serial}" "passenger"
  passenger_app_booted=true
  verify_app_boot_on_serial "${driver_serial}" "driver"
  driver_app_booted=true
fi

# shellcheck source=/dev/null
source "${OUTPUT_DIR}/android-passenger-runtime-version.env"
passenger_version_code="${VERSION_CODE}"
passenger_version_name="${VERSION_NAME}"
# shellcheck source=/dev/null
source "${OUTPUT_DIR}/android-driver-runtime-version.env"
driver_version_code="${VERSION_CODE}"
driver_version_name="${VERSION_NAME}"

if [[ "${REQUIRE_MATCHING_ANDROID_APP_VERSION}" == "true" ]]; then
  if [[ -z "${passenger_version_code}" || -z "${driver_version_code}" || -z "${passenger_version_name}" || -z "${driver_version_name}" ]]; then
    fail "blocked_precondition:android_role_pair_not_ready could not resolve app versions for passenger and driver runtimes"
  fi
  if [[ "${passenger_version_code}" != "${driver_version_code}" || "${passenger_version_name}" != "${driver_version_name}" ]]; then
    fail "blocked_precondition:android_role_pair_not_ready passenger/driver app versions differ: passenger=${passenger_version_name}/${passenger_version_code} driver=${driver_version_name}/${driver_version_code}"
  fi
fi

cat > "${OUTPUT_DIR}/android-role-runtime-verification.json" <<JSON
{
  "passengerRuntime": "${PASSENGER_RUNTIME}",
  "driverRuntime": "${DRIVER_RUNTIME}",
  "passengerSerial": "${passenger_serial}",
  "driverSerial": "${driver_serial}",
  "passengerAppVersionName": "${passenger_version_name}",
  "passengerAppVersionCode": "${passenger_version_code}",
  "driverAppVersionName": "${driver_version_name}",
  "driverAppVersionCode": "${driver_version_code}",
  "physicalDeviceSerial": "${physical_serial}",
  "emulatorSerial": "${emulator_serial}",
  "passengerAvd": "${PASSENGER_AVD}",
  "driverAvd": "${DRIVER_AVD}",
  "emulatorStabilitySeconds": "${EMULATOR_STABILITY_SECONDS}",
  "requireRunningAndroidApp": "${REQUIRE_RUNNING_ANDROID_APP}",
  "passengerAppBooted": ${passenger_app_booted},
  "driverAppBooted": ${driver_app_booted},
  "appPackage": "${APP_PACKAGE}"
}
JSON

{
  printf 'ANDROID_PASSENGER_SERIAL=%s\n' "${passenger_serial}"
  printf 'ANDROID_DRIVER_SERIAL=%s\n' "${driver_serial}"
  printf 'DRIVER_EMULATOR_SERIAL=%s\n' "${emulator_serial}"
  printf 'PASSENGER_RUNTIME=%s\n' "${PASSENGER_RUNTIME}"
  printf 'DRIVER_RUNTIME=%s\n' "${DRIVER_RUNTIME}"
  printf 'ANDROID_EMULATOR_STABILITY_SECONDS=%s\n' "${EMULATOR_STABILITY_SECONDS}"
} > "${OUTPUT_DIR}/android-role-runtime.env"

log "ready: passenger=${passenger_serial} driver=${driver_serial}"
log "evidence: ${OUTPUT_DIR}/android-role-runtime-verification.json"
