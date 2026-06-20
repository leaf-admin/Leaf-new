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

fail() {
  printf '[real-smoke-preflight][error] %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing command: $1"
}

require_file() {
  [[ -x "$1" || -f "$1" ]] || fail "Missing file: $1"
}

require_cmd curl
require_cmd jq
require_cmd node
require_file "${ADB_BIN}"
require_file "${MAESTRO_BIN}"

log "Artifacts: ${ARTIFACTS_DIR}"
log "Validating Java and Maestro"
java -version 2>&1 | tee "${ARTIFACTS_DIR}/java-version.txt" >/dev/null
"${MAESTRO_BIN}" --version 2>&1 | tee "${ARTIFACTS_DIR}/maestro-version.txt" >/dev/null

log "Validating ADB/device"
"${ADB_BIN}" devices -l | tee "${ARTIFACTS_DIR}/adb-devices.txt" >/dev/null
DEVICE_LINES="$(awk 'NR > 1 && $2 == "device" { print $0 }' "${ARTIFACTS_DIR}/adb-devices.txt")"
if [[ -z "${DEVICE_LINES}" ]]; then
  if [[ "${ALLOW_DEVICE_MISSING}" == "true" ]]; then
    log "blocked_precondition:device_not_ready"
  else
    fail "blocked_precondition:device_not_ready"
  fi
else
  DEVICE_SERIAL="${ANDROID_SERIAL:-$(awk 'NR > 1 && $2 == "device" { print $1; exit }' "${ARTIFACTS_DIR}/adb-devices.txt")}"
  log "Device: ${DEVICE_SERIAL}"
  "${ADB_BIN}" -s "${DEVICE_SERIAL}" shell getprop ro.product.model | tee "${ARTIFACTS_DIR}/android-model.txt" >/dev/null
  "${ADB_BIN}" -s "${DEVICE_SERIAL}" shell getprop ro.build.version.release | tee "${ARTIFACTS_DIR}/android-version.txt" >/dev/null
  "${ADB_BIN}" -s "${DEVICE_SERIAL}" shell dumpsys package "${APP_PACKAGE}" \
    | rg 'versionName|versionCode|firstInstallTime|lastUpdateTime' \
    | tee "${ARTIFACTS_DIR}/app-version.txt" >/dev/null

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

log "Validating backend health"
curl -sS --max-time 12 "${BACKEND_URL%/}/health" \
  | tee "${ARTIFACTS_DIR}/backend-health.json" \
  | jq -e '.status == "healthy"' >/dev/null

log "Validating payment runtime sandbox profile"
PAYMENT_RUNTIME_PHONE="${PASSENGER_PHONE}" \
PAYMENT_RUNTIME_USER_ID="${PASSENGER_UID}" \
PAYMENT_RUNTIME_EXPECTED_ENVIRONMENT=sandbox \
  bash "${QA_SCRIPT_DIR}/assert-backend-payment-runtime-canary.sh" \
    "${BACKEND_URL}" \
    "${ARTIFACTS_DIR}/payment-runtime-canary.json" \
  | tee "${ARTIFACTS_DIR}/payment-runtime-canary.txt"

log "Validating geofence pickup/destination"
curl -sS --max-time 12 "${BACKEND_URL%/}/api/geofence/check?lat=${PICKUP_LAT}&lng=${PICKUP_LNG}" \
  | tee "${ARTIFACTS_DIR}/geofence-pickup.json" \
  | jq -e '.success == true and .isAllowed == true' >/dev/null
curl -sS --max-time 12 "${BACKEND_URL%/}/api/geofence/check?lat=${DESTINATION_LAT}&lng=${DESTINATION_LNG}" \
  | tee "${ARTIFACTS_DIR}/geofence-destination.json" \
  | jq -e '.success == true and .isAllowed == true' >/dev/null

if [[ "${PREPARE_DRIVER}" == "true" ]]; then
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
export TEST_PICKUP_LAT="${PICKUP_LAT}"
export TEST_PICKUP_LNG="${PICKUP_LNG}"
export TEST_FARE="\${TEST_FARE:-54.05}"
EOF

cat > "${ARTIFACTS_DIR}/start-driver-bot.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
source "$(printf '%q' "${ARTIFACTS_DIR}/smoke-env.sh")"

# Manual fallback: the Android smoke runner normally starts a managed driver bot
# after it extracts the canonical pickup coordinate from the app.
TEST_DRIVER_UID="\${TEST_DRIVER_UID}" TEST_PICKUP_LAT="\${TEST_PICKUP_LAT}" TEST_PICKUP_LNG="\${TEST_PICKUP_LNG}" TEST_FARE="\${TEST_FARE}" WS_URL="${SOCKET_URL}" \\
  node leaf-websocket-backend/scripts/tests/driver-dispatch-bot.cjs
EOF

cat > "${ARTIFACTS_DIR}/run-android-smoke.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
source "$(printf '%q' "${ARTIFACTS_DIR}/smoke-env.sh")"

# Real-device smoke runner with sandbox payment auto-confirmation for the canary passenger.
STRICT_QUOTE=true REAL_SMOKE_OPEN_PAYMENT=true REAL_SMOKE_AUTO_CONFIRM_SANDBOX_PAYMENT=true REAL_SMOKE_SYNC_DRIVER_TO_APP_PICKUP=true REAL_SMOKE_REQUIRE_CANONICAL_PICKUP=true FIRST_LAUNCH_WAIT_MS=12000 SECOND_LAUNCH_WAIT_MS=10000 QUOTE_STABILITY_WAIT_MS=16000 REAL_SMOKE_PAYMENT_WAIT_MS=60000 \\
  npm --prefix mobile-app run qa:android:real-smoke
EOF
chmod +x "${ARTIFACTS_DIR}/smoke-env.sh" "${ARTIFACTS_DIR}/start-driver-bot.sh" "${ARTIFACTS_DIR}/run-android-smoke.sh"

log "Preflight ready"
log "Driver bot command: ${ARTIFACTS_DIR}/start-driver-bot.sh"
log "Android smoke command: ${ARTIFACTS_DIR}/run-android-smoke.sh"
