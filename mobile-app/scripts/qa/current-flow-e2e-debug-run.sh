#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
QA_SCRIPT_DIR="${SCRIPT_DIR}"
MOBILE_DIR="$(cd "${QA_SCRIPT_DIR}/../.." && pwd)"
ROOT_DIR="$(cd "${MOBILE_DIR}/.." && pwd)"
APP_ID="${APP_ID:-br.com.leaf.ride}"
RUN_ID="${RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
RUN_DIR="${RUN_DIR:-${MOBILE_DIR}/test-results/current-flow-e2e/${RUN_ID}}"
ANDROID_APK="${ANDROID_APK:-${MOBILE_DIR}/android/app/build/outputs/apk/debug/app-debug.apk}"
IOS_APP="${IOS_APP:-${MOBILE_DIR}/ios/build/Build/Products/Debug-iphonesimulator/Leaf.app}"
METRO_PORT="${METRO_PORT:-8097}"
METRO_URL="${METRO_URL:-http://127.0.0.1:${METRO_PORT}}"
DEV_CLIENT_URL="${DEV_CLIENT_URL:-exp+leafapp-reactnative://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A${METRO_PORT}&disableOnboarding=1}"

# shellcheck source=/dev/null
source "${QA_SCRIPT_DIR}/current-flow-e2e-debug-env.sh"

usage() {
  cat <<'USAGE'
Usage:
  bash mobile-app/scripts/qa/current-flow-e2e-debug-run.sh [options]

Options:
  --doctor         Run non-mutating environment doctor only.
  --ios-only       Restrict doctor/build/install/open to iOS simulators.
  --metro          Restart Metro on METRO_PORT (default: 8097) with current-flow debug env.
  --build-android  Build Android debug APK.
  --build-ios      Build iOS Debug simulator app.
  --build          Build Android and iOS debug artifacts.
  --install        Install existing debug artifacts on detected/declared devices.
  --install-ios    Install the existing debug artifact only on the declared iOS simulators.
  --open           Launch installed apps after install.
  --open-ios       Launch only the declared iOS simulators.
  --all            Doctor, Metro, build, install and open.

Device overrides:
  PASSENGER_ANDROID_SERIAL=emulator-5554
  DRIVER_ANDROID_SERIAL=emulator-5556
  PASSENGER_IOS_UDID=6BC9EC30-C939-4598-A85D-A9E071E90CE5
  DRIVER_IOS_UDID=C52FE30B-CB7E-4628-B352-27143BF6E9D7
USAGE
}

has_arg() {
  local expected="$1"
  shift
  for arg in "$@"; do
    [[ "${arg}" == "${expected}" ]] && return 0
  done
  return 1
}

log() {
  echo "[current-e2e] $*"
}

first_android_serial() {
  "${ADB_BIN}" devices | awk '/\tdevice$/{print $1; exit}'
}

second_android_serial() {
  "${ADB_BIN}" devices | awk '/\tdevice$/{count += 1; if (count == 2) { print $1; exit }}'
}

first_ios_udid() {
  "${SIMCTL_BIN}" list devices booted | awk -F '[()]' '/Booted/ && /iPhone/{gsub(/^[[:space:]]+|[[:space:]]+$/, "", $2); print $2; exit}'
}

second_ios_udid() {
  "${SIMCTL_BIN}" list devices booted | awk -F '[()]' '/Booted/ && /iPhone/{count += 1; if (count == 2) { gsub(/^[[:space:]]+|[[:space:]]+$/, "", $2); print $2; exit }}'
}

run_doctor() {
  mkdir -p "${RUN_DIR}"
  local doctor_args=(--out-dir "${RUN_DIR}/doctor")
  if [[ "${IOS_ONLY:-0}" == "1" ]]; then
    doctor_args+=(--ios-only)
  fi
  node "${QA_SCRIPT_DIR}/current-flow-e2e-lab.cjs" "${doctor_args[@]}"
}

restart_metro() {
  mkdir -p "${RUN_DIR}/metro"
  local pids=""
  pids="$(lsof -ti tcp:${METRO_PORT} 2>/dev/null || true)"
  if [[ -n "${pids}" ]]; then
    log "stopping existing Metro/listener on ${METRO_PORT}: ${pids}"
    kill ${pids} >/dev/null 2>&1 || true
    sleep 2
  fi

  log "starting Metro with debug E2E flags"
  (
    cd "${MOBILE_DIR}"
    nohup env -u CI npx expo start --dev-client --localhost --port "${METRO_PORT}" --clear \
      </dev/null > "${RUN_DIR}/metro/metro.log" 2>&1 &
    echo "$!" > "${RUN_DIR}/metro/metro.pid"
  )

  for _attempt in $(seq 1 45); do
    if curl -sS --max-time 2 "http://127.0.0.1:${METRO_PORT}/status" >/dev/null 2>&1; then
      log "Metro is ready on ${METRO_PORT}"
      return 0
    fi
    sleep 2
  done

  log "Metro did not become ready. See ${RUN_DIR}/metro/metro.log"
  return 1
}

build_android() {
  log "building Android debug APK"
  (
    cd "${MOBILE_DIR}"
    npm run build:local:android:debug
  )
}

build_ios() {
  log "building iOS Debug simulator app"
  (
    cd "${MOBILE_DIR}"
    IOS_SIMULATOR_CONFIGURATION=Debug npm run build:local:ios:simulator
  )
}

grant_android_permissions() {
  local serial="$1"
  [[ -n "${serial}" ]] || return 0
  "${ADB_BIN}" -s "${serial}" shell pm grant "${APP_ID}" android.permission.ACCESS_FINE_LOCATION >/dev/null 2>&1 || true
  "${ADB_BIN}" -s "${serial}" shell pm grant "${APP_ID}" android.permission.ACCESS_COARSE_LOCATION >/dev/null 2>&1 || true
  "${ADB_BIN}" -s "${serial}" shell pm grant "${APP_ID}" android.permission.POST_NOTIFICATIONS >/dev/null 2>&1 || true
}

reverse_android_metro() {
  local serial="$1"
  [[ -n "${serial}" ]] || return 0
  "${ADB_BIN}" -s "${serial}" reverse "tcp:${METRO_PORT}" "tcp:${METRO_PORT}" >/dev/null 2>&1 || true
}

suppress_android_dev_menu() {
  local serial="$1"
  [[ -n "${serial}" ]] || return 0

  "${ADB_BIN}" -s "${serial}" root >/dev/null 2>&1 || true
  "${ADB_BIN}" -s "${serial}" wait-for-device >/dev/null 2>&1 || true
  "${ADB_BIN}" -s "${serial}" shell "mkdir -p /data/data/${APP_ID}/shared_prefs" >/dev/null 2>&1 || true
  "${ADB_BIN}" -s "${serial}" shell "cat > /data/data/${APP_ID}/shared_prefs/expo.modules.devmenu.sharedpreferences.xml <<'EOF'
<?xml version='1.0' encoding='utf-8' standalone='yes' ?>
<map>
    <boolean name=\"isOnboardingFinished\" value=\"true\" />
    <boolean name=\"showsAtLaunch\" value=\"false\" />
    <boolean name=\"showFab\" value=\"false\" />
    <boolean name=\"motionGestureEnabled\" value=\"false\" />
    <boolean name=\"touchGestureEnabled\" value=\"false\" />
    <boolean name=\"keyCommandsEnabled\" value=\"false\" />
</map>
EOF" >/dev/null 2>&1 || true
  local owner
  owner="$("${ADB_BIN}" -s "${serial}" shell "stat -c '%u:%g' /data/data/${APP_ID}" 2>/dev/null | tr -d '\r' || true)"
  if [[ -n "${owner}" ]]; then
    "${ADB_BIN}" -s "${serial}" shell "chown -R ${owner} /data/data/${APP_ID}/shared_prefs" >/dev/null 2>&1 || true
  fi
  "${ADB_BIN}" -s "${serial}" shell "chmod 700 /data/data/${APP_ID}/shared_prefs && chmod 660 /data/data/${APP_ID}/shared_prefs/expo.modules.devmenu.sharedpreferences.xml" >/dev/null 2>&1 || true
}

grant_ios_permissions() {
  local udid="$1"
  [[ -n "${udid}" ]] || return 0
  "${SIMCTL_BIN}" privacy "${udid}" grant location "${APP_ID}" >/dev/null 2>&1 || true
  "${SIMCTL_BIN}" privacy "${udid}" grant notifications "${APP_ID}" >/dev/null 2>&1 || true
}

install_android() {
  local serial="$1"
  [[ -n "${serial}" ]] || return 0
  if [[ ! -f "${ANDROID_APK}" ]]; then
    log "missing Android APK: ${ANDROID_APK}"
    return 1
  fi
  log "installing Android debug APK on ${serial}"
  local install_output=""
  if ! install_output="$("${ADB_BIN}" -s "${serial}" install --no-streaming -r "${ANDROID_APK}" 2>&1)"; then
    if [[ "${install_output}" == *"INSTALL_FAILED_UPDATE_INCOMPATIBLE"* ]]; then
      log "existing ${APP_ID} signature differs on ${serial}; resetting only that AVD package"
      "${ADB_BIN}" -s "${serial}" uninstall "${APP_ID}" >/dev/null
      "${ADB_BIN}" -s "${serial}" install --no-streaming "${ANDROID_APK}" >/dev/null
    else
      printf '%s\n' "${install_output}" >&2
      return 1
    fi
  fi
  grant_android_permissions "${serial}"
  reverse_android_metro "${serial}"
  suppress_android_dev_menu "${serial}"
}

install_ios() {
  local udid="$1"
  [[ -n "${udid}" ]] || return 0
  if [[ ! -d "${IOS_APP}" ]]; then
    log "missing iOS app: ${IOS_APP}"
    return 1
  fi
  log "installing iOS debug app on ${udid}"
  "${SIMCTL_BIN}" install "${udid}" "${IOS_APP}" >/dev/null
  grant_ios_permissions "${udid}"
}

open_android() {
  local serial="$1"
  local role="$2"
  [[ -n "${serial}" ]] || return 0
  reverse_android_metro "${serial}"
  log "opening Android ${role} dev-client on ${serial}"
  local remote_command
  printf -v remote_command \
    "am start -W --ez EXDevMenuDisableAutoLaunch true -a android.intent.action.VIEW -d '%s' %s" \
    "${DEV_CLIENT_URL}" \
    "${APP_ID}"
  "${ADB_BIN}" -s "${serial}" shell "${remote_command}" >/dev/null
}

open_ios() {
  local udid="$1"
  local role="$2"
  [[ -n "${udid}" ]] || return 0
  log "opening iOS ${role} dev-client on ${udid}"
  "${SIMCTL_BIN}" openurl "${udid}" "${DEV_CLIENT_URL}" >/dev/null
}

install_all() {
  local passenger_android="${PASSENGER_ANDROID_SERIAL:-$(first_android_serial)}"
  local driver_android="${DRIVER_ANDROID_SERIAL:-$(second_android_serial)}"
  local passenger_ios="${PASSENGER_IOS_UDID:-$(first_ios_udid)}"
  local driver_ios="${DRIVER_IOS_UDID:-$(second_ios_udid)}"

  mkdir -p "${RUN_DIR}"
  {
    echo "PASSENGER_ANDROID_SERIAL=${passenger_android}"
    echo "DRIVER_ANDROID_SERIAL=${driver_android}"
    echo "PASSENGER_IOS_UDID=${passenger_ios}"
    echo "DRIVER_IOS_UDID=${driver_ios}"
  } > "${RUN_DIR}/devices.env"

  install_android "${passenger_android}"
  install_android "${driver_android}"
  install_ios "${passenger_ios}"
  install_ios "${driver_ios}"
}

install_ios_only() {
  local passenger_ios="${PASSENGER_IOS_UDID:-$(first_ios_udid)}"
  local driver_ios="${DRIVER_IOS_UDID:-$(second_ios_udid)}"

  mkdir -p "${RUN_DIR}"
  {
    echo "PASSENGER_IOS_UDID=${passenger_ios}"
    echo "DRIVER_IOS_UDID=${driver_ios}"
  } > "${RUN_DIR}/devices.env"

  install_ios "${passenger_ios}"
  install_ios "${driver_ios}"
}

open_all() {
  local passenger_android="${PASSENGER_ANDROID_SERIAL:-$(first_android_serial)}"
  local driver_android="${DRIVER_ANDROID_SERIAL:-$(second_android_serial)}"
  local passenger_ios="${PASSENGER_IOS_UDID:-$(first_ios_udid)}"
  local driver_ios="${DRIVER_IOS_UDID:-$(second_ios_udid)}"

  open_android "${passenger_android}" "passenger"
  open_android "${driver_android}" "driver"
  open_ios "${passenger_ios}" "passenger"
  open_ios "${driver_ios}" "driver"
}

open_ios_only() {
  local passenger_ios="${PASSENGER_IOS_UDID:-$(first_ios_udid)}"
  local driver_ios="${DRIVER_IOS_UDID:-$(second_ios_udid)}"

  open_ios "${passenger_ios}" "passenger"
  open_ios "${driver_ios}" "driver"
}

main() {
  if [[ "$#" -eq 0 || "$1" == "--help" || "$1" == "-h" ]]; then
    usage
    exit 0
  fi

  if has_arg "--ios-only" "$@"; then
    IOS_ONLY=1
  fi

  if has_arg "--doctor" "$@"; then
    run_doctor
  fi

  if has_arg "--all" "$@" || has_arg "--metro" "$@"; then
    restart_metro
  fi

  if [[ "${IOS_ONLY:-0}" != "1" ]] &&
    { has_arg "--all" "$@" || has_arg "--build" "$@" || has_arg "--build-android" "$@"; }; then
    build_android
  fi

  if has_arg "--all" "$@" || has_arg "--build" "$@" || has_arg "--build-ios" "$@"; then
    build_ios
  fi

  if has_arg "--all" "$@" || has_arg "--install" "$@"; then
    if [[ "${IOS_ONLY:-0}" == "1" ]]; then
      install_ios_only
    else
      install_all
    fi
  fi

  if has_arg "--install-ios" "$@"; then
    install_ios_only
  fi

  if has_arg "--all" "$@" || has_arg "--open" "$@"; then
    if [[ "${IOS_ONLY:-0}" == "1" ]]; then
      open_ios_only
    else
      open_all
    fi
  fi

  if has_arg "--open-ios" "$@"; then
    open_ios_only
  fi

  log "run dir: ${RUN_DIR}"
}

main "$@"
