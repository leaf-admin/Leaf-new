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
METRO_URL="${METRO_URL:-http://127.0.0.1:8081}"
DEV_CLIENT_URL="${DEV_CLIENT_URL:-exp+leafapp-reactnative://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081&disableOnboarding=1}"

# shellcheck source=/dev/null
source "${QA_SCRIPT_DIR}/current-flow-e2e-debug-env.sh"

usage() {
  cat <<'USAGE'
Usage:
  bash mobile-app/scripts/qa/current-flow-e2e-debug-run.sh [options]

Options:
  --doctor         Run non-mutating environment doctor only.
  --metro          Restart Metro on port 8081 with current-flow debug env.
  --build-android  Build Android debug APK.
  --build-ios      Build iOS Debug simulator app.
  --build          Build Android and iOS debug artifacts.
  --install        Install existing debug artifacts on detected/declared devices.
  --open           Launch installed apps after install.
  --all            Doctor, Metro, build, install and open.

Device overrides:
  PASSENGER_ANDROID_SERIAL=emulator-5554
  DRIVER_ANDROID_SERIAL=emulator-5556
  PASSENGER_IOS_UDID=195D2C57-87DC-4953-ABF1-4FD351ADBBEF
  DRIVER_IOS_UDID=2E44BC8E-9AA8-43BE-BD5E-D0B5A73E543C
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
  node "${QA_SCRIPT_DIR}/current-flow-e2e-lab.cjs" --out-dir "${RUN_DIR}/doctor"
}

restart_metro() {
  mkdir -p "${RUN_DIR}/metro"
  local pids=""
  pids="$(lsof -ti tcp:8081 2>/dev/null || true)"
  if [[ -n "${pids}" ]]; then
    log "stopping existing Metro/listener on 8081: ${pids}"
    kill ${pids} >/dev/null 2>&1 || true
    sleep 2
  fi

  log "starting Metro with debug E2E flags"
  (
    cd "${MOBILE_DIR}"
    nohup script -q /dev/null bash -lc 'env -u CI npx expo start --dev-client --localhost --port 8081 --clear' \
      > "${RUN_DIR}/metro/metro.log" 2>&1 &
    echo "$!" > "${RUN_DIR}/metro/metro.pid"
  )

  for _attempt in $(seq 1 45); do
    if curl -sS --max-time 2 http://127.0.0.1:8081/status >/dev/null 2>&1; then
      log "Metro is ready on 8081"
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
  "${ADB_BIN}" -s "${serial}" reverse tcp:8081 tcp:8081 >/dev/null 2>&1 || true
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
  "${ADB_BIN}" -s "${serial}" install -r "${ANDROID_APK}" >/dev/null
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
  "${ADB_BIN}" -s "${serial}" shell am start \
    --ez EXDevMenuDisableAutoLaunch true \
    -a android.intent.action.VIEW \
    -d "'${DEV_CLIENT_URL}'" \
    "${APP_ID}" >/dev/null
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

main() {
  if [[ "$#" -eq 0 || "$1" == "--help" || "$1" == "-h" ]]; then
    usage
    exit 0
  fi

  if has_arg "--doctor" "$@"; then
    run_doctor
  fi

  if has_arg "--all" "$@" || has_arg "--metro" "$@"; then
    restart_metro
  fi

  if has_arg "--all" "$@" || has_arg "--build" "$@" || has_arg "--build-android" "$@"; then
    build_android
  fi

  if has_arg "--all" "$@" || has_arg "--build" "$@" || has_arg "--build-ios" "$@"; then
    build_ios
  fi

  if has_arg "--all" "$@" || has_arg "--install" "$@"; then
    install_all
  fi

  if has_arg "--all" "$@" || has_arg "--open" "$@"; then
    open_all
  fi

  log "run dir: ${RUN_DIR}"
}

main "$@"
