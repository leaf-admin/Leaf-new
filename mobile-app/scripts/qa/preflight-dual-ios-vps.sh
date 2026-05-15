#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKEND_DIR="${ROOT_DIR}/../leaf-websocket-backend"

API_BASE_URL="${API_BASE_URL:-https://api.leaf.app.br}"
WS_URL="${WS_URL:-https://socket.leaf.app.br}"
SOCKET_BASE_URL="${SOCKET_BASE_URL:-${WS_URL}}"
DASHBOARD_URL="${DASHBOARD_URL:-https://dashboard.leaf.app.br}"

PASSENGER_PHONE="${PASSENGER_PHONE:-21102938475}"
DRIVER_PHONE="${DRIVER_PHONE:-21123456789}"
PASSENGER_UID="${PASSENGER_UID:-OjML1wSzdNRaynjqMRlSW1Y0LVy2}"
DRIVER_UID="${DRIVER_UID:-8vg2kxxqi3TYKlpD6eBlWgYseIq2}"

DO_HOST="${DO_HOST:-147.182.204.181}"
DO_KEY="${DO_KEY:-${ROOT_DIR}/../digitaloceankey}"
DO_REMOTE_ENV_PATH="${DO_REMOTE_ENV_PATH:-/opt/leaf-app/.env}"

PASSENGER_UDID="${PASSENGER_UDID:-195D2C57-87DC-4953-ABF1-4FD351ADBBEF}"
DRIVER_UDID="${DRIVER_UDID:-2E44BC8E-9AA8-43BE-BD5E-D0B5A73E543C}"
SHARED_METRO_PORT="${SHARED_METRO_PORT:-8081}"
PASSENGER_PORT="${PASSENGER_PORT:-${SHARED_METRO_PORT}}"
DRIVER_PORT="${DRIVER_PORT:-${SHARED_METRO_PORT}}"
METRO_STABILITY_WAIT_SEC="${METRO_STABILITY_WAIT_SEC:-25}"

REPORT_DIR="${ROOT_DIR}/test-results/qa-preflight"
mkdir -p "${REPORT_DIR}"
REPORT_FILE="${REPORT_DIR}/preflight-$(date +%Y%m%d_%H%M%S).log"

PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0
STRICT_PREFLIGHT="${STRICT_PREFLIGHT:-false}"

log() {
  printf "[preflight] %s\n" "$1" | tee -a "${REPORT_FILE}"
}

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  printf "[PASS] %s\n" "$1" | tee -a "${REPORT_FILE}"
}

run_with_timeout_to_file() {
  local timeout_sec="$1"
  local output_file="$2"
  shift 2

  (
    "$@"
  ) > "${output_file}" 2>&1 &
  local cmd_pid=$!
  local elapsed=0

  while kill -0 "${cmd_pid}" >/dev/null 2>&1; do
    sleep 1
    elapsed=$((elapsed + 1))
    if [[ "${elapsed}" -ge "${timeout_sec}" ]]; then
      kill "${cmd_pid}" >/dev/null 2>&1 || true
      sleep 1
      kill -9 "${cmd_pid}" >/dev/null 2>&1 || true
      return 124
    fi
  done

  wait "${cmd_pid}"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  printf "[FAIL] %s\n" "$1" | tee -a "${REPORT_FILE}"
}

warn() {
  WARN_COUNT=$((WARN_COUNT + 1))
  printf "[WARN] %s\n" "$1" | tee -a "${REPORT_FILE}"
}

require_cmd() {
  local cmd="$1"
  if command -v "${cmd}" >/dev/null 2>&1; then
    pass "command available: ${cmd}"
  else
    fail "missing command: ${cmd}"
  fi
}

http_code() {
  local url="$1"
  curl -sS -m 10 -o /dev/null -w "%{http_code}" "${url}" || true
}

http_capture() {
  local url="$1"
  local output_file="$2"
  curl -sS -m 15 -o "${output_file}" -w "%{http_code}" "${url}" || true
}

wait_http_ready() {
  local url="$1"
  local label="$2"
  local attempts="${3:-30}"

  for attempt in $(seq 1 "${attempts}"); do
    local code
    code="$(http_code "${url}")"
    if [[ "${code}" == "200" ]]; then
      pass "${label} ready (${code})"
      return 0
    fi
    sleep 2
  done

  fail "${label} not ready via http"
  return 1
}

warm_metro_bundle() {
  local url="$1"
  local label="$2"

  if curl -fsS --max-time 240 "${url}" -o /dev/null; then
    pass "${label} warmed"
  else
    warn "${label} warmup failed; continuing"
  fi
}

LAN_IP="${LAN_IP:-$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)}"
if [[ -z "${LAN_IP}" ]]; then
  LAN_IP="127.0.0.1"
fi
SIMULATOR_METRO_HOST="${SIMULATOR_METRO_HOST:-localhost}"

MAESTRO_METRO_URL_PASSENGER="exp+leafapp-reactnative://expo-development-client/?url=http%3A%2F%2F${SIMULATOR_METRO_HOST}%3A${PASSENGER_PORT}"
MAESTRO_METRO_URL_DRIVER="exp+leafapp-reactnative://expo-development-client/?url=http%3A%2F%2F${SIMULATOR_METRO_HOST}%3A${DRIVER_PORT}"

log "report: ${REPORT_FILE}"
log "lan_ip=${LAN_IP}"
log "simulator_metro_host=${SIMULATOR_METRO_HOST}"
log "api=${API_BASE_URL}"
log "socket=${SOCKET_BASE_URL}"

for c in curl jq node npx xcrun maestro ssh lsof; do
  require_cmd "${c}"
done

if [[ "${FAIL_COUNT}" -gt 0 ]]; then
  log "aborting due to missing commands"
  exit 2
fi

readiness_code="$(http_code "${API_BASE_URL}/health/readiness")"
if [[ "${readiness_code}" == "200" ]]; then
  pass "API readiness endpoint reachable (${readiness_code})"
else
  fail "API readiness endpoint failed (${readiness_code})"
fi

full_health_json="${REPORT_DIR}/api-health-full.json"
health_code="$(http_capture "${API_BASE_URL}/health" "${full_health_json}")"
if [[ "${health_code}" == "200" ]]; then
  pass "API full health endpoint reachable (${health_code})"
else
  if [[ "${readiness_code}" == "200" ]]; then
    warn "API full health reported ${health_code}; readiness is healthy, continuing with capacity finding logged in ${full_health_json}"
  else
    fail "API full health endpoint failed (${health_code})"
  fi
fi

socket_code="$(http_code "${SOCKET_BASE_URL}/socket.io/?EIO=4&transport=polling")"
if [[ "${socket_code}" == "200" || "${socket_code}" == "400" ]]; then
  pass "Socket endpoint reachable (${socket_code})"
else
  fail "Socket endpoint not reachable (${socket_code})"
fi

if [[ ! -f "${DO_KEY}" ]]; then
  fail "missing digitalocean key: ${DO_KEY}"
else
  pass "digitalocean key found"
fi

if [[ "${FAIL_COUNT}" -gt 0 ]]; then
  log "aborting due to network/key checks"
  exit 3
fi

log "ensuring canonical test users in firebase"
ensure_users_json="${REPORT_DIR}/ensure-users.json"
if run_with_timeout_to_file 90 "${ensure_users_json}" \
  bash -lc "cd '${BACKEND_DIR}' && TEST_PASSENGER_PHONE='${PASSENGER_PHONE}' TEST_DRIVER_PHONE='${DRIVER_PHONE}' node scripts/tests/ensure-leaf-test-users.cjs"; then
  PASSENGER_UID="$(jq -r '.passenger.uid // empty' "${ensure_users_json}")"
  DRIVER_UID="$(jq -r '.driver.uid // empty' "${ensure_users_json}")"
  if [[ -n "${PASSENGER_UID}" && -n "${DRIVER_UID}" ]]; then
    pass "test users ensured (passenger=${PASSENGER_UID}, driver=${DRIVER_UID})"
  else
    warn "ensure users returned empty uids; using fallback env/default uids"
  fi
else
  warn "ensure users script failed or timed out (see ${ensure_users_json}); continuing with fallback uids"
fi

log "resetting canonical runtime state on vps"
runtime_cleanup_json="${REPORT_DIR}/runtime-cleanup.json"
if ssh -i "${DO_KEY}" -o StrictHostKeyChecking=no -o ConnectTimeout=8 "root@${DO_HOST}" \
  "docker exec -i -e TEST_PASSENGER_UID='${PASSENGER_UID}' -e TEST_DRIVER_UID='${DRIVER_UID}' leaf-websocket node -" > "${runtime_cleanup_json}" 2>&1 <<'NODE'
const Redis = require('ioredis');

const passengerUid = process.env.TEST_PASSENGER_UID;
const driverUid = process.env.TEST_DRIVER_UID;
const redis = new Redis(process.env.REDIS_URL);

async function main() {
  if (!passengerUid || !driverUid) {
    throw new Error('missing_test_uids');
  }

  await redis.ping();

  const beforePassengerBooking = await redis.get(`customer_active_booking:${passengerUid}`);
  const beforeDriverNotification = await redis.get(`driver_active_notification:${driverUid}`);
  const beforeDriverTrip = await redis.get(`active_trip_by_driver:${driverUid}`);
  const beforeDriverTripCustomer = await redis.get(`active_trip_customer_by_driver:${driverUid}`);

  const keys = new Set([
    `customer_active_booking:${passengerUid}`,
    `driver_soft_ban:${driverUid}`,
    `driver_lock:${driverUid}`,
    `driver_active_notification:${driverUid}`,
    `active_trip_by_driver:${driverUid}`,
    `active_trip_customer_by_driver:${driverUid}`
  ]);

  for (const bookingId of [beforePassengerBooking, beforeDriverNotification, beforeDriverTrip]) {
    if (!bookingId) continue;
    keys.add(`ride_excluded_drivers:${bookingId}`);
    keys.add(`ride_reoffer_cooldown:${bookingId}:${driverUid}`);
  }

  const cooldownKeys = await redis.keys(`ride_reoffer_cooldown:*:${driverUid}`);
  for (const key of cooldownKeys) {
    keys.add(key);
  }

  const deletedKeys = Array.from(keys);
  const deletedCount = deletedKeys.length ? await redis.del(...deletedKeys) : 0;
  await redis.hdel(`driver:${driverUid}`, 'activeTripId', 'activeTripUpdatedAt');

  const afterPassengerBooking = await redis.get(`customer_active_booking:${passengerUid}`);
  const afterDriverNotification = await redis.get(`driver_active_notification:${driverUid}`);
  const afterDriverTrip = await redis.get(`active_trip_by_driver:${driverUid}`);
  const afterDriverTripCustomer = await redis.get(`active_trip_customer_by_driver:${driverUid}`);

  console.log(JSON.stringify({
    ok: true,
    deletedCount,
    deletedKeys,
    before: {
      passengerActiveBooking: beforePassengerBooking || null,
      driverActiveNotification: beforeDriverNotification || null,
      driverActiveTrip: beforeDriverTrip || null,
      driverActiveTripCustomer: beforeDriverTripCustomer || null
    },
    after: {
      passengerActiveBooking: afterPassengerBooking || null,
      driverActiveNotification: afterDriverNotification || null,
      driverActiveTrip: afterDriverTrip || null,
      driverActiveTripCustomer: afterDriverTripCustomer || null
    }
  }, null, 2));
}

main()
  .catch(async (error) => {
    console.log(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await redis.quit();
    } catch (_) {
      redis.disconnect();
    }
  });
NODE
then
  cleanup_ok="$(jq -r '.ok // false' "${runtime_cleanup_json}" 2>/dev/null || echo "false")"
  if [[ "${cleanup_ok}" == "true" ]]; then
    pass "runtime state cleanup ok on vps"
  else
    warn "runtime cleanup returned ok=false (see ${runtime_cleanup_json})"
  fi
else
  warn "runtime cleanup command failed (see ${runtime_cleanup_json})"
fi

log "checking payment bypass on backend"
payment_check_json="${REPORT_DIR}/payment-check.json"
cat > "${REPORT_DIR}/payment-check-payload.json" <<EOF
{
  "passengerId": "${PASSENGER_UID}",
  "amount": 2390,
  "rideId": "preflight_$(date +%s)",
  "rideDetails": {
    "origin": "Preflight Origin",
    "destination": "Preflight Destination"
  },
  "passengerName": "QA Passenger",
  "passengerEmail": "qa@leaf.local"
}
EOF
if curl -sS -m 15 -X POST "${API_BASE_URL}/api/payment/advance" \
  -H "content-type: application/json" \
  -d @"${REPORT_DIR}/payment-check-payload.json" > "${payment_check_json}" 2>&1; then
  pay_success="$(jq -r '.success // false' "${payment_check_json}" 2>/dev/null || echo "false")"
  pay_bypass="$(jq -r '.bypass // false' "${payment_check_json}" 2>/dev/null || echo "false")"
  pay_charge="$(jq -r '.chargeId // empty' "${payment_check_json}" 2>/dev/null || echo "")"
  if [[ "${pay_success}" == "true" && -n "${pay_charge}" ]]; then
    pass "payment advance ok (chargeId=${pay_charge})"
  else
    fail "payment advance failed"
  fi
  if [[ "${pay_bypass}" == "true" ]]; then
    pass "payment bypass enabled for test passenger"
  else
    warn "payment bypass not enabled on backend; relying on app-side E2E auto-confirm path"
  fi
else
  fail "payment advance request failed"
fi

log "reading runtime admin token from vps"
runtime_token="$(
  ssh -i "${DO_KEY}" -o StrictHostKeyChecking=no -o ConnectTimeout=8 "root@${DO_HOST}" \
    "grep -E '^(RUNTIME_ADMIN_TOKEN)=' '${DO_REMOTE_ENV_PATH}' | head -n 1 | cut -d= -f2-" 2>/dev/null || true
)"
if [[ -n "${runtime_token}" ]]; then
  pass "runtime admin token loaded from vps"
else
  warn "runtime admin token not found in ${DO_REMOTE_ENV_PATH}; driver-ready polling will use sleep fallback"
fi

driver_status_json="${REPORT_DIR}/driver-status.json"
if [[ -n "${runtime_token}" ]]; then
  if curl -sS -m 15 \
    "${API_BASE_URL}/api/driver-status/${DRIVER_UID}?token=${runtime_token}" > "${driver_status_json}" 2>&1; then
    can_receive="$(jq -r '.canReceiveRequests // false' "${driver_status_json}" 2>/dev/null || echo "false")"
    eligible_geo="$(jq -r '.details.isEligibleInGeo // false' "${driver_status_json}" 2>/dev/null || echo "false")"
    if [[ "${can_receive}" == "true" && "${eligible_geo}" == "true" ]]; then
      pass "driver is dispatch-eligible"
    else
      warn "driver not dispatch-eligible before smoke (canReceive=${can_receive}, eligibleGeo=${eligible_geo})"
    fi
  else
    warn "driver-status endpoint call failed; continuing without dispatch-ready precheck"
  fi
fi

log "running backend smoke (create booking + dispatch)"
smoke_json="${REPORT_DIR}/smoke-driver-ready-booking.json"
if run_with_timeout_to_file 120 "${smoke_json}" \
  bash -lc "cd '${BACKEND_DIR}' && API_BASE_URL='${API_BASE_URL}' WS_URL='${SOCKET_BASE_URL}' TEST_PASSENGER_UID='${PASSENGER_UID}' TEST_DRIVER_UID='${DRIVER_UID}' TEST_PICKUP_LAT=37.7749 TEST_PICKUP_LNG=-122.4194 TEST_DEST_LAT=37.7849 TEST_DEST_LNG=-122.4094 TEST_PICKUP_ADDRESS='SF Pickup' TEST_DEST_ADDRESS='SF Destination' node scripts/tests/smoke-driver-ready-booking.cjs"; then
  smoke_ok="$(jq -r '.ok // false' "${smoke_json}" 2>/dev/null || echo "false")"
  if [[ "${smoke_ok}" == "true" ]]; then
    pass "backend smoke passed"
  else
    warn "backend smoke did not return ok=true; continuing to UI validation"
  fi
else
  warn "backend smoke command failed or timed out (see ${smoke_json}); continuing to UI validation"
fi

log "starting shared metro server for dual simulators"
pkill -f "expo start --dev-client --port ${PASSENGER_PORT}" >/dev/null 2>&1 || true
sleep 1

(
  cd "${ROOT_DIR}"
  nohup env \
    EXPO_PUBLIC_API_URL="${API_BASE_URL}" \
    EXPO_PUBLIC_WS_URL="${SOCKET_BASE_URL}" \
    EXPO_PUBLIC_SOCKET_URL="${SOCKET_BASE_URL}" \
    EXPO_PUBLIC_DASHBOARD_URL="${DASHBOARD_URL}" \
    EXPO_PUBLIC_E2E_TEST="true" \
    EXPO_PUBLIC_FORCE_PAYMENT_BYPASS="true" \
    bash -lc "exec npx expo start --dev-client --port '${SHARED_METRO_PORT}' --host localhost --clear" \
    > /tmp/leaf-metro-${PASSENGER_PORT}.log 2>&1 < /dev/null &
  echo $! > /tmp/leaf-metro-${PASSENGER_PORT}.pid
)

sleep 4
if lsof -nP -iTCP:"${SHARED_METRO_PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
  pass "metro ${SHARED_METRO_PORT} listening"
else
  warn "metro ${SHARED_METRO_PORT} not listening on first probe; waiting for readiness"
fi

wait_http_ready "http://${SIMULATOR_METRO_HOST}:${SHARED_METRO_PORT}" "metro ${SHARED_METRO_PORT}"
warm_metro_bundle "http://${SIMULATOR_METRO_HOST}:${SHARED_METRO_PORT}/index.bundle?platform=ios&dev=true&minify=false" "metro ${SHARED_METRO_PORT} iOS bundle"

log "validating metro stability window (${METRO_STABILITY_WAIT_SEC}s)"
sleep "${METRO_STABILITY_WAIT_SEC}"
if lsof -nP -iTCP:"${SHARED_METRO_PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
  pass "metro ${SHARED_METRO_PORT} stable after ${METRO_STABILITY_WAIT_SEC}s"
else
  fail "metro ${SHARED_METRO_PORT} dropped before stability window"
fi

log "booting simulators and opening deep links"
open -a Simulator || true
xcrun simctl boot "${PASSENGER_UDID}" >/dev/null 2>&1 || true
xcrun simctl boot "${DRIVER_UDID}" >/dev/null 2>&1 || true
sleep 1

xcrun simctl openurl "${PASSENGER_UDID}" "${MAESTRO_METRO_URL_PASSENGER}" >/dev/null 2>&1 || true
xcrun simctl openurl "${DRIVER_UDID}" "${MAESTRO_METRO_URL_DRIVER}" >/dev/null 2>&1 || true
pass "deep links sent to both simulators"

env_file="${REPORT_DIR}/maestro-runtime-env.sh"
cat > "${env_file}" <<EOF
export MAESTRO_METRO_HOST="${SIMULATOR_METRO_HOST}"
export MAESTRO_METRO_URL_PASSENGER="${MAESTRO_METRO_URL_PASSENGER}"
export MAESTRO_METRO_URL_DRIVER="${MAESTRO_METRO_URL_DRIVER}"
export API_BASE_URL="${API_BASE_URL}"
export PASSENGER_UID="${PASSENGER_UID}"
export DRIVER_UID="${DRIVER_UID}"
export PASSENGER_UDID="${PASSENGER_UDID}"
export DRIVER_UDID="${DRIVER_UDID}"
export RUNTIME_ADMIN_TOKEN="${runtime_token}"
EOF
pass "maestro env file written (${env_file})"

if [[ "${STRICT_PREFLIGHT}" == "true" && "${WARN_COUNT}" -gt 0 ]]; then
  fail "strict mode enabled and warnings detected (${WARN_COUNT})"
fi

log "summary: pass=${PASS_COUNT} warn=${WARN_COUNT} fail=${FAIL_COUNT}"
if [[ "${FAIL_COUNT}" -gt 0 ]]; then
  log "preflight failed"
  log "check report: ${REPORT_FILE}"
  exit 9
fi

log "preflight passed"
log "next:"
log "  source ${env_file}"
log "  maestro test .maestro/flows/qa/e2e/01-driver-login-online-8082.yaml --device ${DRIVER_UDID}"
log "  maestro test .maestro/flows/qa/e2e/02-passenger-login-8081.yaml --device ${PASSENGER_UDID}"
log "  maestro test .maestro/flows/qa/e2e/03-passenger-request-ride.yaml --device ${PASSENGER_UDID}"
