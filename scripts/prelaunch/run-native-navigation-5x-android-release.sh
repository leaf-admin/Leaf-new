#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MOBILE_DIR="${ROOT_DIR}/mobile-app"
BACKEND_DIR="${ROOT_DIR}/leaf-websocket-backend"

# shellcheck source=/dev/null
source "${MOBILE_DIR}/scripts/source-local-build-env.sh" >/dev/null 2>&1 || true

APP_ID="${APP_ID:-br.com.leaf.ride}"
APK_PATH="${ANDROID_RELEASE_APK:-${MOBILE_DIR}/android/app/build/outputs/apk/release/app-release.apk}"
API_BASE_URL="${API_BASE_URL:-https://api.leaf.app.br}"
WS_URL="${WS_URL:-https://socket.leaf.app.br}"
RUNS="${RUNS:-5}"
PICKUP_APPROACH_WAIT_SECONDS="${PICKUP_APPROACH_WAIT_SECONDS:-45}"
DRIVER_ACTION_MODE="${DRIVER_ACTION_MODE:-automation}"
PASSENGER_REQUEST_MODE="${PASSENGER_REQUEST_MODE:-automation}"
PASSENGER_USER_KEY="${PASSENGER_USER_KEY:-passengerTwo}"
DRIVER_USER_KEY="${DRIVER_USER_KEY:-driverTwo}"

PASSENGER_AVD="${PASSENGER_AVD:-Leaf_API_35}"
DRIVER_AVD="${DRIVER_AVD:-Leaf_API_35_Driver}"
PASSENGER_SERIAL="${PASSENGER_SERIAL:-emulator-5554}"
DRIVER_SERIAL="${DRIVER_SERIAL:-emulator-5556}"

PICKUP_LABEL="${PICKUP_LABEL:-Copacabana Palace, Rio de Janeiro, RJ}"
PICKUP_LAT="${PICKUP_LAT:--22.971964}"
PICKUP_LNG="${PICKUP_LNG:--43.182543}"
DRIVER_LAT="${DRIVER_LAT:--22.970800}"
DRIVER_LNG="${DRIVER_LNG:--43.181900}"
PICKUP_APPROACH_LAT="${PICKUP_APPROACH_LAT:--22.971382}"
PICKUP_APPROACH_LNG="${PICKUP_APPROACH_LNG:--43.182156}"
DESTINATION_LAT="${DESTINATION_LAT:--22.984843}"
DESTINATION_LNG="${DESTINATION_LNG:--43.221972}"

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
ARTIFACTS_ROOT="${ARTIFACTS_ROOT:-${ROOT_DIR}/reports/native-navigation-5x-android-release-${TIMESTAMP}}"

NODE_BIN="${NODE_BIN:-$(command -v node)}"
ADB_BIN="${ADB_BIN:-${ANDROID_HOME:-${HOME}/Android/Sdk}/platform-tools/adb}"
EMULATOR_BIN="${EMULATOR_BIN:-${ANDROID_HOME:-${HOME}/Android/Sdk}/emulator/emulator}"
SEED_STATE_SCRIPT="${MOBILE_DIR}/scripts/qa/seed-prototype-android-state.cjs"
READ_RUNTIME_SCRIPT="${ROOT_DIR}/scripts/validation/lib/read-android-runtime-state.cjs"
WAIT_DRIVER_AVAILABILITY_SCRIPT="${ROOT_DIR}/scripts/prelaunch/wait-driver-availability.cjs"
ENSURE_USERS_FILE="${MOBILE_DIR}/test-results/qa-preflight/ensure-users.json"
PASSENGER_REQUEST_RELEASE_FLOW="${MOBILE_DIR}/.maestro/flows/qa/e2e/lifecycle/02-passenger-request-copacabana-release-direct.yaml"
DRIVER_ACCEPT_OFFER_FLOW="${MOBILE_DIR}/.maestro/flows/qa/e2e/lifecycle/03-driver-accept-offer.yaml"
DRIVER_ARRIVE_FLOW="${MOBILE_DIR}/.maestro/flows/qa/e2e/lifecycle/04-driver-arrived.yaml"
DRIVER_START_FLOW="${MOBILE_DIR}/.maestro/flows/qa/e2e/lifecycle/05-driver-start-trip.yaml"
DRIVER_COMPLETE_FLOW="${MOBILE_DIR}/.maestro/flows/qa/e2e/lifecycle/06-driver-complete-trip.yaml"
PASSENGER_RATE_FLOW="${MOBILE_DIR}/.maestro/flows/qa/e2e/lifecycle/07-passenger-rate-trip.yaml"
DRIVER_RATE_PASSENGER_FLOW="${MOBILE_DIR}/.maestro/flows/qa/e2e/lifecycle/08-driver-rate-passenger.yaml"

export ADB_BIN API_BASE_URL WS_URL
export EXPO_PUBLIC_API_URL="${API_BASE_URL}"
export EXPO_PUBLIC_BACKEND_URL="${API_BASE_URL}"
export EXPO_PUBLIC_WS_URL="${WS_URL}"
export EXPO_PUBLIC_SOCKET_URL="${WS_URL}"
export EXPO_PUBLIC_FORCE_PAYMENT_BYPASS=true
export EXPO_PUBLIC_ALLOW_INSECURE_HTTP=true
export EXPO_PUBLIC_E2E_TEST=1
export EXPO_PUBLIC_PROTOTYPE_PICKUP_SPEED_MPS="${EXPO_PUBLIC_PROTOTYPE_PICKUP_SPEED_MPS:-16.667}"
export EXPO_PUBLIC_PROTOTYPE_TRIP_SPEED_MPS="${EXPO_PUBLIC_PROTOTYPE_TRIP_SPEED_MPS:-16.667}"
export EXPO_PUBLIC_PROTOTYPE_ROUTE_PLAYBACK_QA_MULTIPLIER="${EXPO_PUBLIC_PROTOTYPE_ROUTE_PLAYBACK_QA_MULTIPLIER:-1}"

mkdir -p "${ARTIFACTS_ROOT}" "$(dirname "${ENSURE_USERS_FILE}")"

log() {
  printf '[native-nav-android-5x] %s\n' "$*"
}

append_timeline() {
  local file="$1"
  local stage="$2"
  local details="${3:-{}}"
  "${NODE_BIN}" -e '
    const fs = require("fs");
    const [file, stage, raw] = process.argv.slice(1);
    let details = {};
    try { details = JSON.parse(raw || "{}"); } catch (_) {}
    fs.appendFileSync(file, JSON.stringify({ stage, at: new Date().toISOString(), details }) + "\n");
  ' "${file}" "${stage}" "${details}"
}

adb_cmd() {
  local serial="$1"
  shift
  "${ADB_BIN}" -s "${serial}" "$@"
}

run_with_timeout() {
  local timeout_seconds="$1"
  shift
  "$@" &
  local pid=$!
  (
    sleep "${timeout_seconds}"
    kill "${pid}" >/dev/null 2>&1 || true
    sleep 1
    kill -9 "${pid}" >/dev/null 2>&1 || true
  ) &
  local watcher_pid=$!
  local status=0
  wait "${pid}" || status=$?
  kill "${watcher_pid}" >/dev/null 2>&1 || true
  wait "${watcher_pid}" >/dev/null 2>&1 || true
  return "${status}"
}

wait_for_android_boot() {
  local serial="$1"
  local timeout_seconds="${2:-240}"
  local started_at
  started_at="$(date +%s)"
  "${ADB_BIN}" -s "${serial}" wait-for-device >/dev/null 2>&1 || true
  while (( $(date +%s) - started_at < timeout_seconds )); do
    local booted
    booted="$(adb_cmd "${serial}" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)"
    if [[ "${booted}" == "1" ]]; then
      return 0
    fi
    sleep 2
  done
  return 1
}

disable_android_animations() {
  local serial="$1"
  run_with_timeout 8 adb_cmd "${serial}" shell settings put global window_animation_scale 0 >/dev/null 2>&1 || true
  run_with_timeout 8 adb_cmd "${serial}" shell settings put global transition_animation_scale 0 >/dev/null 2>&1 || true
  run_with_timeout 8 adb_cmd "${serial}" shell settings put global animator_duration_scale 0 >/dev/null 2>&1 || true
}

boot_avd() {
  local avd="$1"
  local serial="$2"
  local port="$3"
  local emulator_log="${ARTIFACTS_ROOT}/emulator-${avd}.log"

  if "${ADB_BIN}" devices | awk -v serial="${serial}" '$1 == serial && $2 == "device" { found = 1 } END { exit found ? 0 : 1 }'; then
    wait_for_android_boot "${serial}" 30 || true
    disable_android_animations "${serial}"
    return 0
  fi

  log "booting ${avd} on ${serial}"
  nohup "${EMULATOR_BIN}" \
    -avd "${avd}" \
    -port "${port}" \
    -no-snapshot-load \
    -no-snapshot-save \
    -no-boot-anim \
    -gpu swiftshader_indirect \
    > "${emulator_log}" 2>&1 &

  wait_for_android_boot "${serial}" 300
  disable_android_animations "${serial}"
}

install_app() {
  local serial="$1"
  run_with_timeout 120 adb_cmd "${serial}" install -r "${APK_PATH}" >/dev/null
  run_with_timeout 8 adb_cmd "${serial}" shell pm grant "${APP_ID}" android.permission.ACCESS_FINE_LOCATION >/dev/null 2>&1 || true
  run_with_timeout 8 adb_cmd "${serial}" shell pm grant "${APP_ID}" android.permission.ACCESS_COARSE_LOCATION >/dev/null 2>&1 || true
  run_with_timeout 8 adb_cmd "${serial}" shell appops set "${APP_ID}" android:mock_location allow >/dev/null 2>&1 || true
}

set_location() {
  local serial="$1"
  local lat="$2"
  local lng="$3"
  adb_cmd "${serial}" emu geo fix "${lng}" "${lat}" >/dev/null 2>&1 || true
}

simulate_driver_motion() {
  local start_lat="$1"
  local start_lng="$2"
  local end_lat="$3"
  local end_lng="$4"
  local duration_seconds="${5:-45}"
  local out_file="${6:-}"
  local steps=10
  local sleep_seconds=5

  if (( duration_seconds > 0 )); then
    steps=$((duration_seconds / sleep_seconds))
    if (( steps < 2 )); then
      steps=2
    fi
  fi

  "${NODE_BIN}" -e '
    const [startLat, startLng, endLat, endLng, steps] = process.argv.slice(1).map(Number);
    for (let i = 0; i <= steps; i += 1) {
      const ratio = steps === 0 ? 1 : i / steps;
      const lat = startLat + (endLat - startLat) * ratio;
      const lng = startLng + (endLng - startLng) * ratio;
      console.log(`${lat.toFixed(6)},${lng.toFixed(6)}`);
    }
  ' -- "${start_lat}" "${start_lng}" "${end_lat}" "${end_lng}" "${steps}" | while IFS=, read -r lat lng; do
    set_location "${DRIVER_SERIAL}" "${lat}" "${lng}"
    if [[ -n "${out_file}" ]]; then
      printf '{"at":"%s","lat":%s,"lng":%s}\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        "${lat}" \
        "${lng}" >> "${out_file}" || true
    fi
    sleep "${sleep_seconds}"
  done
}

open_leaf_url() {
  local serial="$1"
  local url="$2"
  local escaped_url
  escaped_url="${url//\'/\'\\\\\'\'}"
  run_with_timeout 12 adb_cmd "${serial}" shell \
    "am start -a android.intent.action.VIEW -d '${escaped_url}' -n '${APP_ID}/.MainActivity'" >/dev/null 2>&1 \
    || run_with_timeout 10 adb_cmd "${serial}" shell \
      "monkey -p '${APP_ID}' -c android.intent.category.LAUNCHER 1" >/dev/null 2>&1 \
    || true
}

launch_home() {
  local serial="$1"
  local nonce="$2"
  open_leaf_url "${serial}" "leafapp://robotaxi/home?qaAutomation=1&qaNonce=${nonce}"
}

reset_and_prepare_storage() {
  local serial="$1"
  local nonce="$2"

  adb_cmd "${serial}" shell pm clear "${APP_ID}" >/dev/null 2>&1 || true
  adb_cmd "${serial}" shell pm grant "${APP_ID}" android.permission.ACCESS_FINE_LOCATION >/dev/null 2>&1 || true
  adb_cmd "${serial}" shell pm grant "${APP_ID}" android.permission.ACCESS_COARSE_LOCATION >/dev/null 2>&1 || true
  adb_cmd "${serial}" shell appops set "${APP_ID}" android:mock_location allow >/dev/null 2>&1 || true
  launch_home "${serial}" "storage-init-${nonce}-$(date +%s)"
  sleep 8
  adb_cmd "${serial}" shell am force-stop "${APP_ID}" >/dev/null 2>&1 || true
}

runtime_json() {
  local serial="$1"
  local output
  if output="$(run_with_timeout 12 "${NODE_BIN}" "${READ_RUNTIME_SCRIPT}" --device "${serial}" --app-id "${APP_ID}" 2>/dev/null)"; then
    printf '%s' "${output}"
  else
    printf '{}'
  fi
}

runtime_field() {
  local serial="$1"
  local field="$2"
  runtime_json "${serial}" | "${NODE_BIN}" -e '
    let raw = "";
    process.stdin.on("data", d => raw += d);
    process.stdin.on("end", () => {
      let value = "";
      try {
        const parsed = JSON.parse(raw || "{}");
        value = parsed[process.argv[1]];
      } catch (_) {}
      if (value === undefined || value === null) return;
      process.stdout.write(typeof value === "string" ? value : JSON.stringify(value));
    });
  ' "${field}"
}

runtime_role_ok() {
  local serial="$1"
  local expected_role="$2"
  runtime_json "${serial}" | "${NODE_BIN}" -e '
    let raw = "";
    process.stdin.on("data", d => raw += d);
    process.stdin.on("end", () => {
      let s = {};
      try { s = JSON.parse(raw || "{}"); } catch (_) {}
      const expected = String(process.argv[1] || "").trim();
      const activeRole = String(s.activeRole || "").trim();
      const bookingStatus = String(s.bookingStatus || "").trim();
      const roleOk = activeRole === expected || (expected === "customer" && activeRole === "passenger");
      process.exit(roleOk && bookingStatus ? 0 : 1);
    });
  ' "${expected_role}"
}

wait_runtime_predicate() {
  local serial="$1"
  local timeout_seconds="$2"
  local js_predicate="$3"
  local started_at
  started_at="$(date +%s)"
  while true; do
    if runtime_json "${serial}" | "${NODE_BIN}" -e '
      let raw = "";
      process.stdin.on("data", d => raw += d);
      process.stdin.on("end", () => {
        let s = {};
        try { s = JSON.parse(raw || "{}"); } catch (_) {}
        const predicate = process.argv[1];
        const ok = Function("s", `return (${predicate});`)(s);
        process.exit(ok ? 0 : 1);
      });
    ' "${js_predicate}"; then
      return 0
    fi
    if (( $(date +%s) - started_at >= timeout_seconds )); then
      return 1
    fi
    sleep 2
  done
}

capture_device() {
  local serial="$1"
  local output="$2"
  run_with_timeout 15 adb_cmd "${serial}" exec-out screencap -p > "${output}" || true
}

capture_pair() {
  local run_dir="$1"
  local slug="$2"
  sleep "${3:-4}"
  capture_device "${PASSENGER_SERIAL}" "${run_dir}/${slug}-passenger.png"
  capture_device "${DRIVER_SERIAL}" "${run_dir}/${slug}-driver.png"
}

run_maestro_flow() {
  local serial="$1"
  local flow="$2"
  local output_dir="$3"
  local timeout_seconds="${4:-180}"
  local attempt attempt_log command_status
  mkdir -p "${output_dir}"
  for attempt in 1 2; do
    attempt_log="${output_dir}/maestro-attempt-${attempt}.log"
    command_status=0
    run_with_timeout "${timeout_seconds}" maestro test \
      --device "${serial}" \
      --debug-output "${output_dir}/debug-output-attempt-${attempt}" \
      --test-output-dir "${output_dir}/attempt-${attempt}" \
      "${flow}" > "${attempt_log}" 2>&1
    command_status=$?
    cat "${attempt_log}" || true

    if [[ "${command_status}" == "0" ]] &&
      ! grep -Eiq '(^|[[:space:]])FAILED($|[[:space:]])|Assertion is false|io\.grpc\.StatusRuntimeException|Command failed \(tcp:' "${attempt_log}"; then
      return 0
    fi

    if [[ "${attempt}" == "1" ]]; then
      log "maestro flow failed on ${serial}; restarting adb and retrying once"
      "${ADB_BIN}" kill-server >/dev/null 2>&1 || true
      "${ADB_BIN}" start-server >/dev/null 2>&1 || true
      wait_for_android_boot "${serial}" 60 || true
      sleep 4
    fi
  done
  return 1
}

seed_auth_and_state() {
  local run_dir="$1"
  adb_cmd "${PASSENGER_SERIAL}" shell am force-stop "${APP_ID}" >/dev/null 2>&1 || true
  adb_cmd "${DRIVER_SERIAL}" shell am force-stop "${APP_ID}" >/dev/null 2>&1 || true

  reset_and_prepare_storage "${PASSENGER_SERIAL}" "passenger-${RANDOM}"
  reset_and_prepare_storage "${DRIVER_SERIAL}" "driver-${RANDOM}"

  seed_state_only "${run_dir}"
  assert_seeded_runtime "${run_dir}" "seeded"
}

seed_state_only() {
  local run_dir="$1"
  seed_passenger_state_only "${run_dir}"
  "${NODE_BIN}" "${SEED_STATE_SCRIPT}" --device "${DRIVER_SERIAL}" --scenario driver-home --uid "${DRIVER_UID}" --artifact-dir "${run_dir}/state-driver" --skip-launch --freeze-ms 0 --root-write --current-lat "${DRIVER_LAT}" --current-lng "${DRIVER_LNG}" --current-address "Driver staging point" >/dev/null

  set_location "${DRIVER_SERIAL}" "${DRIVER_LAT}" "${DRIVER_LNG}"
}

seed_passenger_state_only() {
  local run_dir="$1"
  "${NODE_BIN}" "${SEED_STATE_SCRIPT}" --device "${PASSENGER_SERIAL}" --scenario passenger-home --uid "${PASSENGER_UID}" --artifact-dir "${run_dir}/state-passenger" --skip-launch --freeze-ms 0 --root-write --current-lat "${PICKUP_LAT}" --current-lng "${PICKUP_LNG}" --current-address "${PICKUP_LABEL}" >/dev/null
  set_location "${PASSENGER_SERIAL}" "${PICKUP_LAT}" "${PICKUP_LNG}"
}

assert_seeded_runtime() {
  local run_dir="$1"
  local label="$2"
  runtime_json "${PASSENGER_SERIAL}" > "${run_dir}/passenger-runtime-${label}.json" || true
  runtime_json "${DRIVER_SERIAL}" > "${run_dir}/driver-runtime-${label}.json" || true
  runtime_role_ok "${PASSENGER_SERIAL}" customer && runtime_role_ok "${DRIVER_SERIAL}" driver
}

ensure_runtime_after_warm() {
  local run_dir="$1"
  local index="$2"

  assert_seeded_runtime "${run_dir}" "after-warm" || true
  log "run ${index}: refreshing seeded runtime after warm"
  adb_cmd "${PASSENGER_SERIAL}" shell am force-stop "${APP_ID}" >/dev/null 2>&1 || true
  adb_cmd "${DRIVER_SERIAL}" shell am force-stop "${APP_ID}" >/dev/null 2>&1 || true
  seed_state_only "${run_dir}"
  assert_seeded_runtime "${run_dir}" "reseeded" || return 1
  launch_home "${PASSENGER_SERIAL}" "passenger-reseed-warm-${index}-$(date +%s)"
  launch_home "${DRIVER_SERIAL}" "driver-reseed-warm-${index}-$(date +%s)"
  sleep 12
  assert_seeded_runtime "${run_dir}" "after-reseed-warm"
}

driver_action() {
  local action="$1"
  local nonce="$2"
  local booking_id="${3:-}"
  local url="leafapp://robotaxi/home?qaAutomation=1&qaDriverAction=${action}&qaNonce=${nonce}"
  if [[ -n "${booking_id}" ]]; then
    url="${url}&qaBookingId=${booking_id}"
  fi
  open_leaf_url "${DRIVER_SERIAL}" "${url}"
}

retry_driver_action_until_status() {
  local action="$1"
  local expected_status="$2"
  local nonce_prefix="$3"
  local booking_id="$4"
  local run_dir="$5"
  local timeout_seconds="${6:-180}"
  local interval_seconds="${7:-12}"
  local started_at attempt
  started_at="$(date +%s)"
  attempt=1

  while true; do
    log "driver ${action} attempt ${attempt}"
    driver_action "${action}" "${nonce_prefix}-${attempt}-$(date +%s)" "${booking_id}"
    local expected_predicate="s.bookingStatus === \"${expected_status}\""
    if [[ "${action}" == "complete_trip" ]]; then
      expected_predicate='s.bookingStatus === "completed" || (s.bookingStatus === "idle" && s.lastReceipt && s.lastReceipt.id)'
    fi
    if wait_runtime_predicate "${DRIVER_SERIAL}" "${interval_seconds}" "${expected_predicate}"; then
      return 0
    fi

    runtime_json "${DRIVER_SERIAL}" > "${run_dir}/driver-${action}-attempt-${attempt}.json" || true
    if (( $(date +%s) - started_at >= timeout_seconds )); then
      return 1
    fi
    attempt=$((attempt + 1))
  done
}

run_rating_automation() {
  local serial="$1"
  local reviewer_type="$2"
  local expected_field="$3"
  local nonce="$4"
  local booking_id="${5:-}"
  local booking_query=""
  if [[ -n "${booking_id}" ]]; then
    booking_query="&qaBookingId=${booking_id}"
  fi

  for attempt in 1 2 3; do
    if [[ "${reviewer_type}" == "driver" ]]; then
      open_leaf_url "${serial}" "leafapp://robotaxi/home?qaAutomation=1&qaDriverAction=rate_last_receipt&qaNonce=${nonce}-${attempt}${booking_query}"
    else
      open_leaf_url "${serial}" "leafapp://robotaxi/home?qaAutomation=1&qaPassengerAction=rate_last_receipt&qaNonce=${nonce}-${attempt}${booking_query}"
    fi

    if wait_runtime_predicate "${serial}" 30 "Boolean(s.lastReceipt && s.lastReceipt.${expected_field})"; then
      return 0
    fi
    sleep 5
  done

  return 1
}

passenger_request() {
  local nonce="$1"
  local run_dir="$2"
  if [[ "${PASSENGER_REQUEST_MODE}" == "automation" ]]; then
    open_leaf_url "${PASSENGER_SERIAL}" "leafapp://robotaxi/home?qaAutomation=1&qaPassengerAction=request_seeded_destination&qaNonce=${nonce}"
    return 0
  fi

  run_maestro_flow \
    "${PASSENGER_SERIAL}" \
    "${PASSENGER_REQUEST_RELEASE_FLOW}" \
    "${run_dir}/passenger-request-${nonce}" \
    480
}

bring_driver_online() {
  local run_dir="$1"
  launch_home "${DRIVER_SERIAL}" "driver-home-$(date +%s)"
  sleep 18
  wait_runtime_predicate "${DRIVER_SERIAL}" 45 's.isSocketAuthenticated === true || s.isSocketConnected === true' || true
  for attempt in 1 2 3 4; do
    log "driver online attempt ${attempt}"
    driver_action set_online "driver-online-${attempt}-$(date +%s)"
    sleep 16
    runtime_json "${DRIVER_SERIAL}" > "${run_dir}/driver-online-attempt-${attempt}.json" || true
    if [[ "$(runtime_field "${DRIVER_SERIAL}" driverOnline)" == "true" ]]; then
      log "driver online confirmed"
      return 0
    fi
  done

  run_maestro_flow \
    "${DRIVER_SERIAL}" \
    "${MOBILE_DIR}/.maestro/flows/qa/e2e/lifecycle/01-driver-toggle-online.yaml" \
    "${run_dir}/driver-online-ui-fallback" \
    180 || true
  sleep 20
  runtime_json "${DRIVER_SERIAL}" > "${run_dir}/driver-online-ui-fallback.json" || true
  [[ "$(runtime_field "${DRIVER_SERIAL}" driverOnline)" == "true" ]]
}

wait_driver_available_for_passenger_request() {
  local run_dir="$1"
  local timeline="$2"
  local output_file="${run_dir}/driver-availability-before-passenger-request.json"

  log "waiting backend availability before passenger request"
  if "${NODE_BIN}" "${WAIT_DRIVER_AVAILABILITY_SCRIPT}" \
    --api-base-url "${API_BASE_URL}" \
    --driver-uid "${DRIVER_UID}" \
    --lat "${PICKUP_LAT}" \
    --lng "${PICKUP_LNG}" \
    --driver-lat "${DRIVER_LAT}" \
    --driver-lng "${DRIVER_LNG}" \
    --radius-km 10 \
    --timeout-ms 90000 \
    --repair-after-ms 15000 \
    --output "${output_file}" \
    > "${run_dir}/driver-availability-before-passenger-request.log" 2>&1; then
    append_timeline "${timeline}" driver_available_for_request "$(jq -c \
      '{driverReady,repaired,count,matchedDriver}' \
      "${output_file}" 2>/dev/null || printf '{}')"
    return 0
  fi

  runtime_json "${DRIVER_SERIAL}" > "${run_dir}/driver-runtime-availability-timeout.json" || true
  append_timeline "${timeline}" driver_availability_failed "$(jq -c \
    --slurpfile availability "${output_file}" \
    --slurpfile runtime "${run_dir}/driver-runtime-availability-timeout.json" \
    '{availability:($availability[0] // {}), runtime:($runtime[0] // {})}')"
  return 1
}

wait_booking_created() {
  wait_runtime_predicate "${PASSENGER_SERIAL}" 180 'Boolean(s.activeBookingId) && s.activeBookingId !== "null"'
}

wait_driver_status() {
  local expected="$1"
  wait_runtime_predicate "${DRIVER_SERIAL}" 180 "s.bookingStatus === \"${expected}\""
}

wait_passenger_status() {
  local expected="$1"
  wait_runtime_predicate "${PASSENGER_SERIAL}" 180 "s.bookingStatus === \"${expected}\""
}

driver_distance_to_pickup_meters() {
  runtime_json "${DRIVER_SERIAL}" | "${NODE_BIN}" -e '
    let raw = "";
    process.stdin.on("data", d => raw += d);
    process.stdin.on("end", () => {
      let s = {};
      try { s = JSON.parse(raw || "{}"); } catch (_) {}
      const current = s.currentCoordinate || s.driverCoordinate || s.driverActiveRide?.driverCoordinate || null;
      const pickup = s.driverTripMeta?.pickupCoordinate || s.driverActiveRide?.pickupCoordinate || s.activeBooking?.pickupLocation || null;
      const lat1 = Number(current?.latitude ?? current?.lat);
      const lon1 = Number(current?.longitude ?? current?.lng);
      const lat2 = Number(pickup?.latitude ?? pickup?.lat);
      const lon2 = Number(pickup?.longitude ?? pickup?.lng);
      if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return;
      const rad = Math.PI / 180;
      const earthMeters = 6371000;
      const dLat = (lat2 - lat1) * rad;
      const dLon = (lon2 - lon1) * rad;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
      process.stdout.write(String(Math.round(2 * earthMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))));
    });
  '
}

wait_driver_near_pickup() {
  local timeout_seconds="${1:-300}"
  local threshold_meters="${2:-140}"
  local out_file="${3:-}"
  local started_at
  started_at="$(date +%s)"

  while true; do
    local meters
    meters="$(driver_distance_to_pickup_meters || true)"
    if [[ -n "${out_file}" ]]; then
      printf '{"at":"%s","distanceMeters":%s,"thresholdMeters":%s}\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        "${meters:-null}" \
        "${threshold_meters}" >> "${out_file}" || true
    fi
    if [[ -n "${meters}" ]] && (( meters <= threshold_meters )); then
      log "driver near pickup: ${meters}m <= ${threshold_meters}m"
      return 0
    fi
    if (( $(date +%s) - started_at >= timeout_seconds )); then
      log "driver did not reach pickup threshold: ${meters:-unknown}m > ${threshold_meters}m"
      return 1
    fi
    sleep 5
  done
}

run_one_ride() {
  local index="$1"
  local run_dir="${ARTIFACTS_ROOT}/run-${index}"
  local timeline="${run_dir}/timeline.jsonl"
  mkdir -p "${run_dir}"
  : > "${timeline}"
  append_timeline "${timeline}" run_started "{\"run\":\"${index}\"}"

  log "run ${index}: seeding clean runtime"
  seed_auth_and_state "${run_dir}"
  append_timeline "${timeline}" seeded

  log "run ${index}: warming passenger/driver apps"
  launch_home "${PASSENGER_SERIAL}" "passenger-warm-${index}-$(date +%s)"
  launch_home "${DRIVER_SERIAL}" "driver-warm-${index}-$(date +%s)"
  capture_pair "${run_dir}" "00-home-warmed" 8
  ensure_runtime_after_warm "${run_dir}" "${index}"
  append_timeline "${timeline}" apps_warmed

  log "run ${index}: bringing driver online"
  bring_driver_online "${run_dir}" || return 1
  wait_driver_available_for_passenger_request "${run_dir}" "${timeline}" || return 1
  capture_pair "${run_dir}" "01-driver-online" 4

  log "run ${index}: passenger requesting ride"
  adb_cmd "${PASSENGER_SERIAL}" shell am force-stop "${APP_ID}" >/dev/null 2>&1 || true
  seed_passenger_state_only "${run_dir}"
  runtime_json "${PASSENGER_SERIAL}" > "${run_dir}/passenger-runtime-before-request-seed.json" || true
  passenger_request "request-${index}-$(date +%s)" "${run_dir}"
  wait_booking_created
  local booking_id
  booking_id="$(runtime_field "${PASSENGER_SERIAL}" activeBookingId)"
  capture_pair "${run_dir}" "02-ride-requested" 6
  append_timeline "${timeline}" ride_requested "{\"bookingId\":\"${booking_id}\"}"

  log "run ${index}: driver accepting"
  if [[ "${DRIVER_ACTION_MODE}" == "maestro" ]]; then
    run_maestro_flow "${DRIVER_SERIAL}" "${DRIVER_ACCEPT_OFFER_FLOW}" "${run_dir}/driver-accept-flow" 180
  else
    retry_driver_action_until_status accept_offer accepted "accept-${index}" "${booking_id}" "${run_dir}" 180 14
  fi
  wait_driver_status accepted
  wait_passenger_status accepted
  capture_pair "${run_dir}" "03-driver-accepted-native-navigation" 8

  simulate_driver_motion "${DRIVER_LAT}" "${DRIVER_LNG}" "${PICKUP_APPROACH_LAT}" "${PICKUP_APPROACH_LNG}" 20 "${run_dir}/driver-motion-to-pickup.jsonl"
  capture_pair "${run_dir}" "04-enroute-to-pickup-navigation" 2
  simulate_driver_motion "${PICKUP_APPROACH_LAT}" "${PICKUP_APPROACH_LNG}" "${PICKUP_LAT}" "${PICKUP_LNG}" "${PICKUP_APPROACH_WAIT_SECONDS}" "${run_dir}/driver-motion-to-pickup.jsonl"
  launch_home "${DRIVER_SERIAL}" "driver-before-arrive-${index}-$(date +%s)"
  sleep 8
  wait_driver_near_pickup 300 140 "${run_dir}/driver-distance-to-pickup.jsonl"
  capture_pair "${run_dir}" "04b-at-pickup-before-arrival" 1

  log "run ${index}: arrive/start/complete"
  if [[ "${DRIVER_ACTION_MODE}" == "maestro" ]]; then
    run_maestro_flow "${DRIVER_SERIAL}" "${DRIVER_ARRIVE_FLOW}" "${run_dir}/driver-arrive-flow" 180
  else
    retry_driver_action_until_status arrive_pickup arrived "arrive-${index}" "${booking_id}" "${run_dir}" 180 12
  fi
  wait_driver_status arrived
  wait_passenger_status arrived
  capture_pair "${run_dir}" "05-driver-arrived" 5

  if [[ "${DRIVER_ACTION_MODE}" == "maestro" ]]; then
    run_maestro_flow "${DRIVER_SERIAL}" "${DRIVER_START_FLOW}" "${run_dir}/driver-start-flow" 180
  else
    retry_driver_action_until_status start_trip started "start-${index}" "${booking_id}" "${run_dir}" 180 12
  fi
  wait_driver_status started
  wait_passenger_status started
  capture_pair "${run_dir}" "06-trip-started-native-navigation" 8

  simulate_driver_motion "${PICKUP_LAT}" "${PICKUP_LNG}" "${DESTINATION_LAT}" "${DESTINATION_LNG}" 35 "${run_dir}/driver-motion-to-destination.jsonl"
  launch_home "${DRIVER_SERIAL}" "driver-before-complete-${index}-$(date +%s)"
  sleep 5
  capture_pair "${run_dir}" "07-trip-in-progress-navigation" 2

  if [[ "${DRIVER_ACTION_MODE}" == "maestro" ]]; then
    run_maestro_flow "${DRIVER_SERIAL}" "${DRIVER_COMPLETE_FLOW}" "${run_dir}/driver-complete-flow" 180
  else
    retry_driver_action_until_status complete_trip completed "complete-${index}" "${booking_id}" "${run_dir}" 180 12
  fi
  wait_passenger_status completed
  wait_runtime_predicate "${DRIVER_SERIAL}" 180 's.bookingStatus === "completed" || s.bookingStatus === "idle"'
  capture_pair "${run_dir}" "08-trip-completed" 6

  log "run ${index}: rating cycle"
  open_leaf_url "${PASSENGER_SERIAL}" "leafapp://robotaxi/home?qaAutomation=1&qaPassengerAction=open_receipt&qaNonce=passenger-receipt-${index}-$(date +%s)&qaBookingId=${booking_id}"
  sleep 5
  run_rating_automation \
    "${PASSENGER_SERIAL}" \
    "passenger" \
    "passengerRatedDriverAt" \
    "passenger-rating-${index}-$(date +%s)" \
    "${booking_id}"
  run_rating_automation \
    "${DRIVER_SERIAL}" \
    "driver" \
    "driverRatedPassengerAt" \
    "driver-rating-${index}-$(date +%s)" \
    "${booking_id}"
  capture_pair "${run_dir}" "09-rating-cycle" 4

  runtime_json "${PASSENGER_SERIAL}" > "${run_dir}/passenger-runtime-final.json"
  runtime_json "${DRIVER_SERIAL}" > "${run_dir}/driver-runtime-final.json"
  run_with_timeout 20 bash -lc "cd \"${BACKEND_DIR}\" && \"${NODE_BIN}\" scripts/tests/report-ride-cost-telemetry.cjs \"${booking_id}\"" > "${run_dir}/ride-cost-telemetry.json" 2>/dev/null || true

  local driver_status passenger_status receipt_id driver_online passenger_rating_at driver_rating_at
  local passenger_final_fare driver_final_fare passenger_driver_net driver_driver_net passenger_total_fees driver_total_fees
  passenger_status="$(runtime_field "${PASSENGER_SERIAL}" bookingStatus)"
  driver_status="$(runtime_field "${DRIVER_SERIAL}" bookingStatus)"
  driver_online="$(runtime_field "${DRIVER_SERIAL}" driverOnline)"
  receipt_id="$(jq -r '.lastReceipt.id // empty' "${run_dir}/passenger-runtime-final.json" 2>/dev/null || true)"
  driver_receipt_id="$(jq -r '.lastReceipt.id // empty' "${run_dir}/driver-runtime-final.json" 2>/dev/null || true)"
  passenger_rating_at="$(jq -r '.lastReceipt.passengerRatedDriverAt // empty' "${run_dir}/passenger-runtime-final.json" 2>/dev/null || true)"
  driver_rating_at="$(jq -r '.lastReceipt.driverRatedPassengerAt // empty' "${run_dir}/driver-runtime-final.json" 2>/dev/null || true)"
  passenger_final_fare="$(jq -r '(.lastReceipt.finalFare // .lastReceipt.fare // empty) | tostring' "${run_dir}/passenger-runtime-final.json" 2>/dev/null || true)"
  driver_final_fare="$(jq -r '(.lastReceipt.finalFare // .lastReceipt.fare // empty) | tostring' "${run_dir}/driver-runtime-final.json" 2>/dev/null || true)"
  passenger_driver_net="$(jq -r '(.lastReceipt.driverNetAmount // empty) | tostring' "${run_dir}/passenger-runtime-final.json" 2>/dev/null || true)"
  driver_driver_net="$(jq -r '(.lastReceipt.driverNetAmount // empty) | tostring' "${run_dir}/driver-runtime-final.json" 2>/dev/null || true)"
  passenger_total_fees="$(jq -r '(.lastReceipt.totalFees // empty) | tostring' "${run_dir}/passenger-runtime-final.json" 2>/dev/null || true)"
  driver_total_fees="$(jq -r '(.lastReceipt.totalFees // empty) | tostring' "${run_dir}/driver-runtime-final.json" 2>/dev/null || true)"

  if [[ -z "${receipt_id}" || "${passenger_status}" != "completed" ]]; then
    log "run ${index}: passenger did not finish cleanly (status=${passenger_status}, receipt=${receipt_id:-none}, driverReceipt=${driver_receipt_id:-none})"
    return 1
  fi

  if [[ -z "${passenger_rating_at}" || -z "${driver_rating_at}" ]]; then
    log "run ${index}: rating cycle incomplete (passengerRatedDriverAt=${passenger_rating_at:-none}, driverRatedPassengerAt=${driver_rating_at:-none})"
    return 1
  fi

  if [[ "${driver_status}" != "completed" && "${driver_status}" != "idle" ]]; then
    log "run ${index}: driver did not finish cleanly (status=${driver_status})"
    return 1
  fi

  if ! jq -en \
    --arg pf "${passenger_final_fare}" \
    --arg df "${driver_final_fare}" \
    --arg pn "${passenger_driver_net}" \
    --arg dn "${driver_driver_net}" \
    --arg pt "${passenger_total_fees}" \
    --arg dt "${driver_total_fees}" \
    'def n($v): ($v | tonumber?);
     (n($pf) != null and n($df) != null and ((n($pf) - n($df)) | fabs) <= 0.01)
     and (n($pn) != null and n($dn) != null and ((n($pn) - n($dn)) | fabs) <= 0.01)
     and (n($pt) != null and n($dt) != null and ((n($pt) - n($dt)) | fabs) <= 0.01)' \
    >/dev/null; then
    log "run ${index}: financial mismatch passenger/driver (fare ${passenger_final_fare:-none}/${driver_final_fare:-none}, net ${passenger_driver_net:-none}/${driver_driver_net:-none}, fees ${passenger_total_fees:-none}/${driver_total_fees:-none})"
    return 1
  fi

  jq -nc \
    --arg run "${index}" \
    --arg bookingId "${booking_id}" \
    --arg receiptId "${receipt_id}" \
    --arg passengerStatus "${passenger_status}" \
    --arg driverStatus "${driver_status}" \
    --arg driverOnline "${driver_online}" \
    --arg passengerRatedDriverAt "${passenger_rating_at}" \
    --arg driverRatedPassengerAt "${driver_rating_at}" \
    --arg passengerFinalFare "${passenger_final_fare}" \
    --arg driverFinalFare "${driver_final_fare}" \
    --arg passengerDriverNet "${passenger_driver_net}" \
    --arg driverDriverNet "${driver_driver_net}" \
    --arg passengerTotalFees "${passenger_total_fees}" \
    --arg driverTotalFees "${driver_total_fees}" \
    --arg artifactDir "${run_dir}" \
    '{run:$run,status:"passed",bookingId:$bookingId,receiptId:$receiptId,passengerStatus:$passengerStatus,driverStatus:$driverStatus,driverOnline:$driverOnline,passengerRatedDriverAt:$passengerRatedDriverAt,driverRatedPassengerAt:$driverRatedPassengerAt,passengerFinalFare:$passengerFinalFare,driverFinalFare:$driverFinalFare,passengerDriverNet:$passengerDriverNet,driverDriverNet:$driverDriverNet,passengerTotalFees:$passengerTotalFees,driverTotalFees:$driverTotalFees,artifactDir:$artifactDir}' \
    > "${run_dir}/run-summary.json"
  append_timeline "${timeline}" run_finished "{\"bookingId\":\"${booking_id}\",\"receiptId\":\"${receipt_id}\"}"
}

if [[ ! -x "${ADB_BIN}" ]]; then
  log "adb not found: ${ADB_BIN}"
  exit 1
fi
if [[ ! -x "${EMULATOR_BIN}" ]]; then
  log "emulator not found: ${EMULATOR_BIN}"
  exit 1
fi
if [[ ! -f "${APK_PATH}" ]]; then
  log "Release APK not found: ${APK_PATH}"
  exit 1
fi

log "artifacts: ${ARTIFACTS_ROOT}"
printf '%s\n' "${ARTIFACTS_ROOT}" > "${ROOT_DIR}/tmp-evidence/latest-native-navigation-5x-android-release-dir.txt"

boot_avd "${PASSENGER_AVD}" "${PASSENGER_SERIAL}" 5554
boot_avd "${DRIVER_AVD}" "${DRIVER_SERIAL}" 5556

log "installing Android Release APK"
install_app "${PASSENGER_SERIAL}"
install_app "${DRIVER_SERIAL}"

log "ensuring test users"
"${NODE_BIN}" "${BACKEND_DIR}/scripts/tests/ensure-leaf-test-users.cjs" > "${ENSURE_USERS_FILE}"
PASSENGER_UID="$(jq -r --arg key "${PASSENGER_USER_KEY}" '.[$key].uid // .passenger.uid' "${ENSURE_USERS_FILE}")"
DRIVER_UID="$(jq -r --arg key "${DRIVER_USER_KEY}" '.[$key].uid // .driver.uid' "${ENSURE_USERS_FILE}")"
jq \
  --arg passengerKey "${PASSENGER_USER_KEY}" \
  --arg driverKey "${DRIVER_USER_KEY}" \
  --arg passengerUid "${PASSENGER_UID}" \
  --arg driverUid "${DRIVER_UID}" \
  '{passengerKey:$passengerKey,driverKey:$driverKey,passenger:$passengerUid,driver:$driverUid,all:{passenger:.passenger.uid,passengerTwo:.passengerTwo.uid,passengerThree:.passengerThree.uid,passengerFour:.passengerFour.uid,driver:.driver.uid,driverTwo:.driverTwo.uid,driverThree:.driverThree.uid}}' \
  "${ENSURE_USERS_FILE}" > "${ARTIFACTS_ROOT}/users.json"

log "cleaning pre-existing active rides"
PASSENGER_UID="${PASSENGER_UID}" DRIVER_UID="${DRIVER_UID}" WS_URL="${WS_URL}" \
  "${NODE_BIN}" "${ROOT_DIR}/scripts/prelaunch/cleanup-active-ride.cjs" \
  > "${ARTIFACTS_ROOT}/pre-run-active-ride-cleanup.json" 2>&1 || true

passed=0
failed=0
for i in $(seq -w 1 "${RUNS}"); do
  if run_one_ride "${i}" > "${ARTIFACTS_ROOT}/run-${i}.log" 2>&1; then
    log "run ${i}: PASSED"
    passed=$((passed + 1))
  else
    exit_code=$?
    log "run ${i}: FAILED exit=${exit_code}"
    failed=$((failed + 1))
    jq -nc --arg run "${i}" --arg status failed --argjson exitCode "${exit_code}" '{run:$run,status:$status,exitCode:$exitCode}' > "${ARTIFACTS_ROOT}/run-${i}/run-summary.json" 2>/dev/null || true
    break
  fi
done

"${NODE_BIN}" - <<'NODE' "${ARTIFACTS_ROOT}" "${passed}" "${failed}" "${RUNS}"
const fs = require("fs");
const path = require("path");
const [root, passedRaw, failedRaw, totalRaw] = process.argv.slice(2);
const runs = fs.readdirSync(root)
  .filter((name) => /^run-\d+/.test(name) && fs.existsSync(path.join(root, name, "run-summary.json")))
  .sort()
  .map((name) => JSON.parse(fs.readFileSync(path.join(root, name, "run-summary.json"), "utf8")));
const aggregate = {
  root,
  generatedAt: new Date().toISOString(),
  requestedRuns: Number(totalRaw),
  passed: Number(passedRaw),
  failed: Number(failedRaw),
  go: Number(passedRaw) === Number(totalRaw) && Number(failedRaw) === 0,
  runs,
};
fs.writeFileSync(path.join(root, "aggregate-summary.json"), JSON.stringify(aggregate, null, 2));
console.log(JSON.stringify(aggregate, null, 2));
NODE

[[ "${failed}" == "0" ]]
