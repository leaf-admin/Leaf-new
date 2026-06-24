#!/usr/bin/env bash
set -euo pipefail

QA_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_DIR="$(cd "${QA_SCRIPT_DIR}/../.." && pwd)"
ROOT_DIR="$(cd "${MOBILE_DIR}/.." && pwd)"
BACKEND_DIR="${ROOT_DIR}/leaf-websocket-backend"
ARTIFACTS_DIR="${MOBILE_DIR}/test-results/real-smoke-preflight-$(date -u +%Y%m%dT%H%M%SZ)"

BACKEND_URL="${BACKEND_URL:-https://api.leaf.app.br}"
SOCKET_URL="${SOCKET_URL:-https://socket.leaf.app.br}"
APP_PACKAGE="${APP_PACKAGE:-br.com.leaf.ride}"
PASSENGER_UID="${PASSENGER_UID:-3tEQ8pQ2QzeWbMKhLGsXHHhnOGL2}"
PASSENGER_PHONE="${PASSENGER_PHONE:-21102938475}"
DRIVER_UID="${DRIVER_UID:-8vg2kxxqi3TYKlpD6eBlWgYseIq2}"
PICKUP_LAT="${PICKUP_LAT:--22.999357}"
PICKUP_LNG="${PICKUP_LNG:--43.357071}"
DESTINATION_LAT="${DESTINATION_LAT:--22.9673111}"
DESTINATION_LNG="${DESTINATION_LNG:--43.1789541}"
PREPARE_DRIVER="${PREPARE_DRIVER:-false}"
ALLOW_DEVICE_MISSING="${ALLOW_DEVICE_MISSING:-false}"
USE_DEVICE_LOCATION_FOR_PICKUP="${USE_DEVICE_LOCATION_FOR_PICKUP:-true}"
REQUIRE_ANDROID_ROLE_PAIR="${REQUIRE_ANDROID_ROLE_PAIR:-true}"
PASSENGER_RUNTIME="${PASSENGER_RUNTIME:-android_device}"
DRIVER_RUNTIME="${DRIVER_RUNTIME:-android_emulator}"
PASSENGER_AVD="${PASSENGER_AVD:-Leaf_API_35}"
DRIVER_AVD="${DRIVER_AVD:-Leaf_API_35_Driver}"
REQUIRE_RUNNING_ANDROID_EMULATOR="${REQUIRE_RUNNING_ANDROID_EMULATOR:-false}"
ANDROID_EMULATOR_STABILITY_SECONDS="${ANDROID_EMULATOR_STABILITY_SECONDS:-60}"
ANDROID_PASSENGER_SERIAL="${ANDROID_PASSENGER_SERIAL:-}"
ANDROID_DRIVER_SERIAL="${ANDROID_DRIVER_SERIAL:-}"
DRIVER_EMULATOR_SERIAL="${DRIVER_EMULATOR_SERIAL:-}"
ANDROID_DRIVER_APK="${ANDROID_DRIVER_APK:-}"
FORCE_INSTALL_DRIVER_APK="${FORCE_INSTALL_DRIVER_APK:-}"
DRIVER_APK_VERSION_CODE=""
DRIVER_APK_VERSION_NAME=""
DEVICE_APP_VERSION_CODE=""
DEVICE_APP_VERSION_NAME=""
PREFLIGHT_STATUS="running"
PREFLIGHT_BLOCKER=""
PREFLIGHT_MESSAGE=""
PREFLIGHT_STEP="init"
PREFLIGHT_SUMMARY_WRITTEN="false"

mkdir -p "${ARTIFACTS_DIR}"

if [[ -f "${MOBILE_DIR}/scripts/source-local-build-env.sh" ]]; then
  # shellcheck source=/dev/null
  source "${MOBILE_DIR}/scripts/source-local-build-env.sh"
fi

ADB_BIN="${ADB_BIN:-${ANDROID_SDK_ROOT:-${HOME}/Android/Sdk}/platform-tools/adb}"
MAESTRO_BIN="${MAESTRO_BIN:-${HOME}/.maestro/bin/maestro}"

log() {
  printf '[real-smoke-preflight] %s\n' "$*"
}

write_preflight_summary() {
  local exit_code="${1:-0}"
  if [[ "${PREFLIGHT_SUMMARY_WRITTEN}" == "true" ]]; then
    return 0
  fi
  PREFLIGHT_SUMMARY_WRITTEN="true"

  if [[ "${PREFLIGHT_STATUS}" == "running" ]]; then
    if [[ "${exit_code}" == "0" ]]; then
      PREFLIGHT_STATUS="pass"
    else
      PREFLIGHT_STATUS="fail"
    fi
  fi

  if ! command -v node >/dev/null 2>&1; then
    return 0
  fi

  PREFLIGHT_STATUS="${PREFLIGHT_STATUS}" \
  PREFLIGHT_BLOCKER="${PREFLIGHT_BLOCKER}" \
  PREFLIGHT_MESSAGE="${PREFLIGHT_MESSAGE}" \
  PREFLIGHT_STEP="${PREFLIGHT_STEP}" \
  PREFLIGHT_EXIT_CODE="${exit_code}" \
  ARTIFACTS_DIR="${ARTIFACTS_DIR}" \
  BACKEND_URL="${BACKEND_URL}" \
  SOCKET_URL="${SOCKET_URL}" \
  APP_PACKAGE="${APP_PACKAGE}" \
  PASSENGER_UID="${PASSENGER_UID}" \
  PASSENGER_PHONE="${PASSENGER_PHONE}" \
  DRIVER_UID="${DRIVER_UID}" \
  PASSENGER_RUNTIME="${PASSENGER_RUNTIME}" \
  DRIVER_RUNTIME="${DRIVER_RUNTIME}" \
  PASSENGER_AVD="${PASSENGER_AVD}" \
  DRIVER_AVD="${DRIVER_AVD}" \
  REQUIRE_RUNNING_ANDROID_EMULATOR="${REQUIRE_RUNNING_ANDROID_EMULATOR}" \
  ANDROID_EMULATOR_STABILITY_SECONDS="${ANDROID_EMULATOR_STABILITY_SECONDS}" \
  DEVICE_SERIAL="${DEVICE_SERIAL:-}" \
  DEVICE_APP_VERSION_NAME="${DEVICE_APP_VERSION_NAME}" \
  DEVICE_APP_VERSION_CODE="${DEVICE_APP_VERSION_CODE}" \
  DRIVER_APK_VERSION_NAME="${DRIVER_APK_VERSION_NAME}" \
  DRIVER_APK_VERSION_CODE="${DRIVER_APK_VERSION_CODE}" \
  ANDROID_DRIVER_APK="${ANDROID_DRIVER_APK}" \
  PICKUP_LAT="${PICKUP_LAT}" \
  PICKUP_LNG="${PICKUP_LNG}" \
  DESTINATION_LAT="${DESTINATION_LAT}" \
  DESTINATION_LNG="${DESTINATION_LNG}" \
  node - <<'NODE'
const fs = require('fs');
const path = require('path');

const env = process.env;
const artifactsDir = env.ARTIFACTS_DIR;
const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(artifactsDir, file), 'utf8'));
  } catch (_error) {
    return null;
  }
};
const exists = (file) => fs.existsSync(path.join(artifactsDir, file));

const paymentRuntime = readJson('payment-runtime-canary.json')?.paymentRuntime?.effectiveProfile || null;
const pickupLocation = readJson('android-location-current.json');
const rolePair = readJson('android-role-pair.json');
const pickupGeofence = readJson('geofence-pickup.json');
const destinationGeofence = readJson('geofence-destination.json');

const summary = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status: env.PREFLIGHT_STATUS,
  exitCode: Number(env.PREFLIGHT_EXIT_CODE || 0),
  step: env.PREFLIGHT_STEP || null,
  blocker: env.PREFLIGHT_BLOCKER || null,
  message: env.PREFLIGHT_MESSAGE || null,
  artifactsDir,
  backendUrl: env.BACKEND_URL,
  socketUrl: env.SOCKET_URL,
  appPackage: env.APP_PACKAGE,
  passenger: {
    uid: env.PASSENGER_UID,
    phone: env.PASSENGER_PHONE,
    runtime: env.PASSENGER_RUNTIME,
    serial: rolePair?.androidPassengerSerial || env.DEVICE_SERIAL || null
  },
  driver: {
    uid: env.DRIVER_UID,
    runtime: env.DRIVER_RUNTIME,
    serial: rolePair?.androidDriverSerial || null,
    avd: env.DRIVER_AVD,
    apk: env.ANDROID_DRIVER_APK || null,
    appVersionName: rolePair?.driverApkVersionName || env.DRIVER_APK_VERSION_NAME || null,
    appVersionCode: rolePair?.driverApkVersionCode || env.DRIVER_APK_VERSION_CODE || null
  },
  android: {
    physicalDeviceSerial: rolePair?.connectedDeviceSerial || env.DEVICE_SERIAL || null,
    passengerAvd: env.PASSENGER_AVD,
    driverAvd: env.DRIVER_AVD,
    requireRunningEmulator: env.REQUIRE_RUNNING_ANDROID_EMULATOR,
    emulatorStabilitySeconds: rolePair?.androidEmulatorStabilitySeconds || env.ANDROID_EMULATOR_STABILITY_SECONDS,
    appVersionName: rolePair?.deviceAppVersionName || env.DEVICE_APP_VERSION_NAME || null,
    appVersionCode: rolePair?.deviceAppVersionCode || env.DEVICE_APP_VERSION_CODE || null
  },
  location: {
    pickup: pickupLocation || {
      lat: Number(env.PICKUP_LAT),
      lng: Number(env.PICKUP_LNG)
    },
    destination: {
      lat: Number(env.DESTINATION_LAT),
      lng: Number(env.DESTINATION_LNG)
    }
  },
  geofence: {
    pickupAllowed: pickupGeofence?.isAllowed ?? null,
    pickupReason: pickupGeofence?.reason || null,
    destinationAllowed: destinationGeofence?.isAllowed ?? null,
    destinationReason: destinationGeofence?.reason || null
  },
  paymentRuntime: paymentRuntime ? {
    effectiveEnvironment: paymentRuntime.environment || null,
    profileId: paymentRuntime.profileId || null,
    contextMatched: Boolean(paymentRuntime.contextMatched),
    expiresAtIso: paymentRuntime.expiresAtIso || null
  } : null,
  generatedFiles: {
    smokeEnv: exists('smoke-env.sh'),
    runAndroidSmoke: exists('run-android-smoke.sh'),
    androidRolePair: exists('android-role-pair.json'),
    paymentRuntimeCanary: exists('payment-runtime-canary.json')
  }
};

fs.writeFileSync(
  path.join(artifactsDir, 'preflight-summary.json'),
  `${JSON.stringify(summary, null, 2)}\n`
);
NODE
}

fail() {
  PREFLIGHT_STATUS="${PREFLIGHT_STATUS:-fail}"
  if [[ "${PREFLIGHT_STATUS}" == "running" ]]; then
    if [[ "$*" == blocked_precondition:* ]]; then
      PREFLIGHT_STATUS="blocked"
    else
      PREFLIGHT_STATUS="fail"
    fi
  fi
  PREFLIGHT_BLOCKER="${PREFLIGHT_BLOCKER:-$*}"
  PREFLIGHT_MESSAGE="$*"
  printf '[real-smoke-preflight][error] %s\n' "$*" >&2
  exit 1
}

trap 'write_preflight_summary "$?"' EXIT

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing command: $1"
}

require_file() {
  [[ -x "$1" || -f "$1" ]] || fail "Missing file: $1"
}

normalize_runtime() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9_' '_'
}

verify_android_package_on_serial() {
  local serial="$1"
  local role="$2"
  local safe_role
  safe_role="$(printf '%s' "${role}" | tr -c 'a-z0-9_' '_')"

  if [[ -z "${serial}" ]]; then
    fail "blocked_precondition:android_role_pair_not_ready ${role} serial is not resolved"
  fi

  local package_list
  package_list="$("${ADB_BIN}" -s "${serial}" shell pm list packages "${APP_PACKAGE}" 2>/dev/null || true)"
  printf '%s\n' "${package_list}" > "${ARTIFACTS_DIR}/android-${safe_role}-package-list.txt"
  if [[ "${package_list}" != *"${APP_PACKAGE}"* ]]; then
    fail "blocked_precondition:android_role_pair_not_ready ${APP_PACKAGE} is not installed on ${role} runtime (${serial})"
  fi

  "${ADB_BIN}" -s "${serial}" shell dumpsys package "${APP_PACKAGE}" \
    | rg 'versionName|versionCode|firstInstallTime|lastUpdateTime' \
    | tee "${ARTIFACTS_DIR}/android-${safe_role}-app-version.txt" >/dev/null
}

classify_payment_runtime_canary_failure() {
  local log_file="$1"
  if [[ -f "${log_file}" ]] && grep -q 'Payment runtime is not sandbox' "${log_file}"; then
    printf 'blocked_precondition:payment_sandbox_not_confirmed'
    return 0
  fi
  if [[ -f "${log_file}" ]] && grep -q 'Runtime config endpoint unreachable' "${log_file}"; then
    printf 'payment_runtime_config_unreachable'
    return 0
  fi
  if [[ -f "${log_file}" ]] && grep -q 'Invalid runtime config response' "${log_file}"; then
    printf 'payment_runtime_config_invalid_response'
    return 0
  fi
  printf 'payment_runtime_canary_failed'
}

find_aapt_bin() {
  if command -v aapt >/dev/null 2>&1; then
    command -v aapt
    return 0
  fi
  find "${ANDROID_SDK_ROOT:-${HOME}/Android/Sdk}/build-tools" -name aapt -type f 2>/dev/null | sort | tail -n 1
}

read_apk_badging() {
  local apk_path="$1"
  local aapt_bin="$2"
  [[ -n "${aapt_bin}" && -f "${apk_path}" ]] || return 1
  "${aapt_bin}" dump badging "${apk_path}" 2>/dev/null | sed -n '1p'
}

extract_badging_field() {
  local field="$1"
  local text="$2"
  sed -n "s/.*${field}='\\([^']*\\)'.*/\\1/p" <<<"${text}" | head -n 1
}

resolve_matching_driver_apk() {
  if [[ -n "${ANDROID_DRIVER_APK}" ]]; then
    return 0
  fi

  DEVICE_APP_VERSION_CODE="$(sed -n 's/.*versionCode=\([0-9][0-9]*\).*/\1/p' "${ARTIFACTS_DIR}/app-version.txt" | head -n 1)"
  DEVICE_APP_VERSION_NAME="$(sed -n 's/.*versionName=\([^[:space:]]*\).*/\1/p' "${ARTIFACTS_DIR}/app-version.txt" | head -n 1)"
  if [[ -z "${DEVICE_APP_VERSION_CODE}" || -z "${DEVICE_APP_VERSION_NAME}" ]]; then
    log "Could not resolve device app version; driver APK auto-resolution skipped"
    return 0
  fi

  local aapt_bin
  aapt_bin="$(find_aapt_bin || true)"
  if [[ -z "${aapt_bin}" ]]; then
    log "aapt not found; driver APK auto-resolution skipped"
    return 0
  fi

  local candidate badging candidate_code candidate_name
  for candidate in \
    "${MOBILE_DIR}/android/app/build/outputs/apk/debug/app-debug.apk" \
    "${MOBILE_DIR}/android/app/build/outputs/apk/release/app-release.apk"; do
    [[ -f "${candidate}" ]] || continue
    badging="$(read_apk_badging "${candidate}" "${aapt_bin}" || true)"
    candidate_code="$(extract_badging_field versionCode "${badging}")"
    candidate_name="$(extract_badging_field versionName "${badging}")"
    printf '%s\tversionName=%s\tversionCode=%s\n' "${candidate}" "${candidate_name}" "${candidate_code}" \
      >> "${ARTIFACTS_DIR}/driver-apk-candidates.tsv"
    if [[ "${candidate_code}" == "${DEVICE_APP_VERSION_CODE}" && "${candidate_name}" == "${DEVICE_APP_VERSION_NAME}" ]]; then
      ANDROID_DRIVER_APK="${candidate}"
      DRIVER_APK_VERSION_CODE="${candidate_code}"
      DRIVER_APK_VERSION_NAME="${candidate_name}"
      log "Resolved matching driver APK: ${ANDROID_DRIVER_APK} (${DRIVER_APK_VERSION_NAME}/${DRIVER_APK_VERSION_CODE})"
      return 0
    fi
  done

  log "No local driver APK matches device app ${DEVICE_APP_VERSION_NAME}/${DEVICE_APP_VERSION_CODE}; L2 runtime verifier will block if emulator app differs"
}

validate_android_role_pair() {
  if [[ "${REQUIRE_ANDROID_ROLE_PAIR}" != "true" ]]; then
    log "Android role pair guard disabled"
    return 0
  fi

  PASSENGER_RUNTIME="$(normalize_runtime "${PASSENGER_RUNTIME}")"
  DRIVER_RUNTIME="$(normalize_runtime "${DRIVER_RUNTIME}")"

  if [[ "${PASSENGER_RUNTIME}" == "${DRIVER_RUNTIME}" ]]; then
    fail "blocked_precondition:android_role_pair_not_ready passenger and driver runtime must be distinct"
  fi

  if [[ " ${PASSENGER_RUNTIME} ${DRIVER_RUNTIME} " != *" android_device "* ]]; then
    fail "blocked_precondition:android_role_pair_not_ready one role must run on the connected Android device"
  fi

  if [[ -z "${DEVICE_SERIAL:-}" ]]; then
    fail "blocked_precondition:android_role_pair_not_ready connected Android device serial is not resolved"
  fi

  if [[ " ${PASSENGER_RUNTIME} ${DRIVER_RUNTIME} " != *" android_emulator "* ]]; then
    fail "blocked_precondition:android_role_pair_not_ready one role must run on an Android emulator"
  fi

  local emulator_bin="${EMULATOR_BIN:-${ANDROID_SDK_ROOT:-${HOME}/Android/Sdk}/emulator/emulator}"
  require_file "${emulator_bin}"

  local required_avd=""
  if [[ "${PASSENGER_RUNTIME}" == "android_emulator" ]]; then
    required_avd="${PASSENGER_AVD}"
  fi
  if [[ "${DRIVER_RUNTIME}" == "android_emulator" ]]; then
    required_avd="${DRIVER_AVD}"
  fi

  if [[ -z "${required_avd}" ]]; then
    fail "blocked_precondition:android_role_pair_not_ready emulator role is missing an AVD name"
  fi

  if ! "${emulator_bin}" -list-avds | grep -qx "${required_avd}"; then
    "${emulator_bin}" -list-avds > "${ARTIFACTS_DIR}/android-avds.txt" 2>&1 || true
    fail "blocked_precondition:android_role_pair_not_ready required AVD not found: ${required_avd}"
  fi

  local emulator_serial=""
  emulator_serial="$("${ADB_BIN}" devices | awk 'NR > 1 && $1 ~ /^emulator-/ && $2 == "device" { print $1; exit }')"
  if [[ "${REQUIRE_RUNNING_ANDROID_EMULATOR}" == "true" && -z "${emulator_serial}" ]]; then
    fail "blocked_precondition:android_role_pair_not_ready Android emulator is not running"
  fi

  ANDROID_PASSENGER_SERIAL=""
  ANDROID_DRIVER_SERIAL=""
  DRIVER_EMULATOR_SERIAL="${emulator_serial}"
  if [[ "${PASSENGER_RUNTIME}" == "android_device" ]]; then
    ANDROID_PASSENGER_SERIAL="${DEVICE_SERIAL:-}"
  elif [[ -n "${emulator_serial}" ]]; then
    ANDROID_PASSENGER_SERIAL="${emulator_serial}"
  fi
  if [[ "${DRIVER_RUNTIME}" == "android_device" ]]; then
    ANDROID_DRIVER_SERIAL="${DEVICE_SERIAL:-}"
  elif [[ -n "${emulator_serial}" ]]; then
    ANDROID_DRIVER_SERIAL="${emulator_serial}"
  fi

  verify_android_package_on_serial "${DEVICE_SERIAL:-}" "device"
  if [[ -n "${emulator_serial}" ]]; then
    verify_android_package_on_serial "${emulator_serial}" "emulator"
  fi

  {
    printf '{\n'
    printf '  "requireAndroidRolePair": true,\n'
    printf '  "passengerRuntime": "%s",\n' "${PASSENGER_RUNTIME}"
    printf '  "driverRuntime": "%s",\n' "${DRIVER_RUNTIME}"
    printf '  "passengerAvd": "%s",\n' "${PASSENGER_AVD}"
    printf '  "driverAvd": "%s",\n' "${DRIVER_AVD}"
    printf '  "requiredAvd": "%s",\n' "${required_avd}"
    printf '  "connectedDeviceSerial": "%s",\n' "${DEVICE_SERIAL:-}"
    printf '  "connectedEmulatorSerial": "%s",\n' "${emulator_serial}"
    printf '  "androidPassengerSerial": "%s",\n' "${ANDROID_PASSENGER_SERIAL}"
    printf '  "androidDriverSerial": "%s",\n' "${ANDROID_DRIVER_SERIAL}"
    printf '  "requireRunningAndroidEmulator": "%s",\n' "${REQUIRE_RUNNING_ANDROID_EMULATOR}"
    printf '  "androidEmulatorStabilitySeconds": "%s",\n' "${ANDROID_EMULATOR_STABILITY_SECONDS}"
    printf '  "deviceAppVersionName": "%s",\n' "${DEVICE_APP_VERSION_NAME}"
    printf '  "deviceAppVersionCode": "%s",\n' "${DEVICE_APP_VERSION_CODE}"
    printf '  "driverApk": "%s",\n' "${ANDROID_DRIVER_APK}"
    printf '  "driverApkVersionName": "%s",\n' "${DRIVER_APK_VERSION_NAME}"
    printf '  "driverApkVersionCode": "%s"\n' "${DRIVER_APK_VERSION_CODE}"
    printf '}\n'
  } > "${ARTIFACTS_DIR}/android-role-pair.json"

  log "Android role pair: passenger=${PASSENGER_RUNTIME}, driver=${DRIVER_RUNTIME}, avd=${required_avd}"
}

require_cmd curl
require_cmd jq
require_cmd node
require_file "${ADB_BIN}"
require_file "${MAESTRO_BIN}"

PREFLIGHT_STEP="tooling"
log "Artifacts: ${ARTIFACTS_DIR}"
log "Validating Java and Maestro"
java -version 2>&1 | tee "${ARTIFACTS_DIR}/java-version.txt" >/dev/null
"${MAESTRO_BIN}" --version 2>&1 | tee "${ARTIFACTS_DIR}/maestro-version.txt" >/dev/null

PREFLIGHT_STEP="android_device"
log "Validating ADB/device"
"${ADB_BIN}" devices -l | tee "${ARTIFACTS_DIR}/adb-devices.txt" >/dev/null
DEVICE_LINES="$(awk 'NR > 1 && $1 !~ /^emulator-/ && $2 == "device" { print $0 }' "${ARTIFACTS_DIR}/adb-devices.txt")"
if [[ -z "${DEVICE_LINES}" ]]; then
  if [[ "${ALLOW_DEVICE_MISSING}" == "true" ]]; then
    log "blocked_precondition:device_not_ready"
  else
    fail "blocked_precondition:device_not_ready"
  fi
else
  DEVICE_SERIAL="${ANDROID_SERIAL:-$(awk 'NR > 1 && $1 !~ /^emulator-/ && $2 == "device" { print $1; exit }' "${ARTIFACTS_DIR}/adb-devices.txt")}"
  if [[ "${DEVICE_SERIAL}" == emulator-* ]]; then
    fail "blocked_precondition:android_role_pair_not_ready connected Android device serial must not be an emulator: ${DEVICE_SERIAL}"
  fi
  log "Device: ${DEVICE_SERIAL}"
  "${ADB_BIN}" -s "${DEVICE_SERIAL}" shell getprop ro.product.model | tee "${ARTIFACTS_DIR}/android-model.txt" >/dev/null
  "${ADB_BIN}" -s "${DEVICE_SERIAL}" shell getprop ro.build.version.release | tee "${ARTIFACTS_DIR}/android-version.txt" >/dev/null
  "${ADB_BIN}" -s "${DEVICE_SERIAL}" shell dumpsys package "${APP_PACKAGE}" \
    | rg 'versionName|versionCode|firstInstallTime|lastUpdateTime' \
    | tee "${ARTIFACTS_DIR}/app-version.txt" >/dev/null
  resolve_matching_driver_apk

  if [[ "${USE_DEVICE_LOCATION_FOR_PICKUP}" == "true" ]]; then
    log "Resolving pickup from Android location provider"
    "${ADB_BIN}" -s "${DEVICE_SERIAL}" shell dumpsys location > "${ARTIFACTS_DIR}/android-location-dumpsys.txt" || true
    DEVICE_LOCATION_JSON="$(node - "${ARTIFACTS_DIR}/android-location-dumpsys.txt" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const dump = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
const providers = ['fused', 'gps', 'network'];
for (const provider of providers) {
  const escaped = provider.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`last location=Location\\[${escaped}\\s+(-?\\d+(?:\\.\\d+)?),(-?\\d+(?:\\.\\d+)?)\\b`);
  const match = dump.match(re);
  if (match) {
    console.log(JSON.stringify({
      provider,
      lat: Number(match[1]),
      lng: Number(match[2])
    }));
    process.exit(0);
  }
}
process.exit(2);
NODE
)" || DEVICE_LOCATION_JSON=""
    if [[ -n "${DEVICE_LOCATION_JSON}" ]]; then
      printf '%s\n' "${DEVICE_LOCATION_JSON}" > "${ARTIFACTS_DIR}/android-location-current.json"
      PICKUP_LAT="$(printf '%s\n' "${DEVICE_LOCATION_JSON}" | jq -r '.lat')"
      PICKUP_LNG="$(printf '%s\n' "${DEVICE_LOCATION_JSON}" | jq -r '.lng')"
      log "Pickup from device GPS: ${PICKUP_LAT}, ${PICKUP_LNG}"
    else
      fail "blocked_precondition:device_location_unavailable"
    fi
  fi
fi

PREFLIGHT_STEP="android_role_pair"
validate_android_role_pair

PREFLIGHT_STEP="backend_health"
log "Validating backend health"
curl -sS --max-time 12 "${BACKEND_URL%/}/health" \
  | tee "${ARTIFACTS_DIR}/backend-health.json" \
  | jq -e '.status == "healthy"' >/dev/null

PREFLIGHT_STEP="geofence"
log "Validating geofence pickup/destination"
curl -sS --max-time 12 "${BACKEND_URL%/}/api/geofence/check?lat=${PICKUP_LAT}&lng=${PICKUP_LNG}" \
  | tee "${ARTIFACTS_DIR}/geofence-pickup.json" \
  | jq -e '.success == true and .isAllowed == true' >/dev/null
curl -sS --max-time 12 "${BACKEND_URL%/}/api/geofence/check?lat=${DESTINATION_LAT}&lng=${DESTINATION_LNG}" \
  | tee "${ARTIFACTS_DIR}/geofence-destination.json" \
  | jq -e '.success == true and .isAllowed == true' >/dev/null

PREFLIGHT_STEP="payment_runtime_sandbox"
log "Validating payment runtime sandbox profile"
set +e
PAYMENT_RUNTIME_PHONE="${PASSENGER_PHONE}" \
PAYMENT_RUNTIME_USER_ID="${PASSENGER_UID}" \
PAYMENT_RUNTIME_EXPECTED_ENVIRONMENT=sandbox \
  bash "${QA_SCRIPT_DIR}/assert-backend-payment-runtime-canary.sh" \
    "${BACKEND_URL}" \
    "${ARTIFACTS_DIR}/payment-runtime-canary.json" \
  | tee "${ARTIFACTS_DIR}/payment-runtime-canary.txt"
payment_runtime_status="${PIPESTATUS[0]}"
set -e
if [[ "${payment_runtime_status}" != "0" ]]; then
  payment_runtime_blocker="$(classify_payment_runtime_canary_failure "${ARTIFACTS_DIR}/payment-runtime-canary.txt")"
  PREFLIGHT_BLOCKER="${payment_runtime_blocker}"
  if [[ "${payment_runtime_blocker}" == blocked_precondition:* ]]; then
    PREFLIGHT_STATUS="blocked"
  else
    PREFLIGHT_STATUS="fail"
  fi
  fail "${payment_runtime_blocker}"
fi

if [[ "${PREPARE_DRIVER}" == "true" ]]; then
  PREFLIGHT_STEP="driver_seed"
  log "Seeding driver eligibility in remote Redis"
  WS_URL="${SOCKET_URL}" \
  E2E_DRIVER_SIM_MODE=remote_ssh \
  TEST_DRIVER_UID="${DRIVER_UID}" \
  TEST_PICKUP_LAT="${PICKUP_LAT}" \
  TEST_PICKUP_LNG="${PICKUP_LNG}" \
  node - <<'NODE' | tee "${ARTIFACTS_DIR}/driver-redis-seed.json"
const RedisDriverSimulator = require(process.cwd() + '/leaf-websocket-backend/tests/e2e/backend/__helpers__/redis-driver-simulator');

(async () => {
  const sim = new RedisDriverSimulator();
  const result = await sim.setDriverOnline(
    process.env.TEST_DRIVER_UID,
    Number(process.env.TEST_PICKUP_LAT),
    Number(process.env.TEST_PICKUP_LNG),
    0,
    0,
    true,
    false
  );
  console.log(JSON.stringify({ ok: true, useRemoteRedis: sim.useRemoteRedis, result }));
})().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message || String(error) }));
  process.exit(2);
});
NODE
fi

FORCE_INSTALL_DRIVER_APK_DEFAULT="${FORCE_INSTALL_DRIVER_APK}"
if [[ -z "${FORCE_INSTALL_DRIVER_APK_DEFAULT}" ]]; then
  if [[ -n "${ANDROID_DRIVER_APK}" ]]; then
    FORCE_INSTALL_DRIVER_APK_DEFAULT="true"
  else
    FORCE_INSTALL_DRIVER_APK_DEFAULT="false"
  fi
fi

cat > "${ARTIFACTS_DIR}/smoke-env.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
cd "${ROOT_DIR}"
source mobile-app/scripts/source-local-build-env.sh
export ADB_BIN="${ADB_BIN}"
export ANDROID_SERIAL="\${ANDROID_SERIAL:-${DEVICE_SERIAL:-}}"
export PAYMENT_RUNTIME_PHONE="${PASSENGER_PHONE}"
export FIREBASE_TEST_PHONE="${PASSENGER_PHONE}"
export PASSENGER_UID="${PASSENGER_UID}"
export REAL_SMOKE_PASSENGER_UID="${PASSENGER_UID}"
export FIREBASE_TEST_UID="${PASSENGER_UID}"
export TEST_DRIVER_UID="${DRIVER_UID}"
export REQUIRE_ANDROID_ROLE_PAIR="${REQUIRE_ANDROID_ROLE_PAIR}"
export PASSENGER_RUNTIME="${PASSENGER_RUNTIME}"
export DRIVER_RUNTIME="${DRIVER_RUNTIME}"
export PASSENGER_AVD="${PASSENGER_AVD}"
export DRIVER_AVD="${DRIVER_AVD}"
export REQUIRE_RUNNING_ANDROID_EMULATOR="${REQUIRE_RUNNING_ANDROID_EMULATOR}"
export ANDROID_EMULATOR_STABILITY_SECONDS="${ANDROID_EMULATOR_STABILITY_SECONDS}"
export ANDROID_PASSENGER_SERIAL="${ANDROID_PASSENGER_SERIAL}"
export ANDROID_DRIVER_SERIAL="${ANDROID_DRIVER_SERIAL}"
export DRIVER_EMULATOR_SERIAL="${DRIVER_EMULATOR_SERIAL}"
export ANDROID_DRIVER_APK="${ANDROID_DRIVER_APK}"
export FORCE_INSTALL_DRIVER_APK="\${FORCE_INSTALL_DRIVER_APK:-${FORCE_INSTALL_DRIVER_APK_DEFAULT}}"
export TEST_PICKUP_LAT="${PICKUP_LAT}"
export TEST_PICKUP_LNG="${PICKUP_LNG}"
export TEST_FARE="\${TEST_FARE:-54.05}"
EOF

cat > "${ARTIFACTS_DIR}/start-driver-emulator.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
source "$(printf '%q' "${ARTIFACTS_DIR}/smoke-env.sh")"

START_DRIVER_EMULATOR=true REQUIRE_RUNNING_ANDROID_EMULATOR=true OUTPUT_DIR="$(printf '%q' "${ARTIFACTS_DIR}")" \\
  bash mobile-app/scripts/qa/verify-android-role-runtimes.sh
EOF

cat > "${ARTIFACTS_DIR}/verify-android-role-runtimes.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
source "$(printf '%q' "${ARTIFACTS_DIR}/smoke-env.sh")"

OUTPUT_DIR="$(printf '%q' "${ARTIFACTS_DIR}")" bash mobile-app/scripts/qa/verify-android-role-runtimes.sh
EOF

cat > "${ARTIFACTS_DIR}/start-driver-bot.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
source "$(printf '%q' "${ARTIFACTS_DIR}/smoke-env.sh")"

# Manual fallback: the Android smoke runner normally starts a managed driver bot
# after it extracts the canonical pickup coordinate from the app. This is not
# accepted as driver-app evidence for full L2 app-to-app validation.
TEST_DRIVER_UID="\${TEST_DRIVER_UID}" TEST_PICKUP_LAT="\${TEST_PICKUP_LAT}" TEST_PICKUP_LNG="\${TEST_PICKUP_LNG}" TEST_FARE="\${TEST_FARE}" WS_URL="${SOCKET_URL}" \\
  node leaf-websocket-backend/scripts/tests/driver-dispatch-bot.cjs
EOF

cat > "${ARTIFACTS_DIR}/run-android-smoke.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
source "$(printf '%q' "${ARTIFACTS_DIR}/smoke-env.sh")"
START_DRIVER_EMULATOR="\${START_DRIVER_EMULATOR:-true}" REQUIRE_RUNNING_ANDROID_EMULATOR=true \\
  "$(printf '%q' "${ARTIFACTS_DIR}/verify-android-role-runtimes.sh")"
source "$(printf '%q' "${ARTIFACTS_DIR}/android-role-runtime.env")"
export ANDROID_SERIAL="\${ANDROID_PASSENGER_SERIAL}"

# Real-device smoke runner with sandbox payment auto-confirmation for the canary passenger.
STRICT_QUOTE=true REAL_SMOKE_OPEN_PAYMENT=true REAL_SMOKE_AUTO_CONFIRM_SANDBOX_PAYMENT=true REAL_SMOKE_SYNC_DRIVER_TO_APP_PICKUP=true REAL_SMOKE_REQUIRE_CANONICAL_PICKUP=true REAL_SMOKE_COMPLETE_EXISTING_RECEIPT=true REAL_SMOKE_VERIFY_ACTIVE_TRIP_MAP_TAP=true REAL_SMOKE_REQUIRE_POST_TRIP=true FIRST_LAUNCH_WAIT_MS=12000 SECOND_LAUNCH_WAIT_MS=10000 QUOTE_STABILITY_WAIT_MS=16000 REAL_SMOKE_PAYMENT_WAIT_MS=60000 \\
  npm --prefix mobile-app run qa:android:real-smoke
EOF
chmod +x "${ARTIFACTS_DIR}/smoke-env.sh" "${ARTIFACTS_DIR}/start-driver-emulator.sh" "${ARTIFACTS_DIR}/verify-android-role-runtimes.sh" "${ARTIFACTS_DIR}/start-driver-bot.sh" "${ARTIFACTS_DIR}/run-android-smoke.sh"

PREFLIGHT_STEP="ready"
PREFLIGHT_STATUS="pass"
log "Preflight ready"
log "Driver emulator command: ${ARTIFACTS_DIR}/start-driver-emulator.sh"
log "Android role runtime verifier: ${ARTIFACTS_DIR}/verify-android-role-runtimes.sh"
log "Driver bot command: ${ARTIFACTS_DIR}/start-driver-bot.sh"
log "Android smoke command: ${ARTIFACTS_DIR}/run-android-smoke.sh"
