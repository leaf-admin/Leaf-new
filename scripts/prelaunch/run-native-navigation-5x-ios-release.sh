#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MOBILE_DIR="${ROOT_DIR}/mobile-app"
BACKEND_DIR="${ROOT_DIR}/leaf-websocket-backend"

APP_ID="${APP_ID:-br.com.leaf.ride}"
APP_PATH="${APP_PATH:-${MOBILE_DIR}/ios/build/Build/Products/Release-iphonesimulator/Leaf.app}"
API_BASE_URL="${API_BASE_URL:-https://api.leaf.app.br}"
WS_URL="${WS_URL:-https://socket.leaf.app.br}"
RUNS="${RUNS:-5}"
RUN_EXTRA_DRIVERS="${RUN_EXTRA_DRIVERS:-0}"
ONLINE_DEEPLINK_ATTEMPTS="${ONLINE_DEEPLINK_ATTEMPTS:-2}"
PICKUP_APPROACH_WAIT_SECONDS="${PICKUP_APPROACH_WAIT_SECONDS:-150}"
DRIVER_ACTION_MODE="${DRIVER_ACTION_MODE:-automation}"

PASSENGER_UDID="${PASSENGER_UDID:-195D2C57-87DC-4953-ABF1-4FD351ADBBEF}"
DRIVER_A_UDID="${DRIVER_A_UDID:-2E44BC8E-9AA8-43BE-BD5E-D0B5A73E543C}"
DRIVER_B_UDID="${DRIVER_B_UDID:-77B44D4A-7D05-4FC2-A84F-0B10715CC37F}"
DRIVER_C_UDID="${DRIVER_C_UDID:-BB96BE67-2C24-47BA-BFFB-199E72CA2E94}"

PICKUP_LABEL="${PICKUP_LABEL:-Praca General Osorio, Ipanema, Rio de Janeiro}"
PICKUP_LAT="${PICKUP_LAT:--22.984600}"
PICKUP_LNG="${PICKUP_LNG:--43.204100}"
DRIVER_A_LAT="${DRIVER_A_LAT:--22.980400}"
DRIVER_A_LNG="${DRIVER_A_LNG:--43.198200}"
DRIVER_B_LAT="${DRIVER_B_LAT:--22.982500}"
DRIVER_B_LNG="${DRIVER_B_LNG:--43.192100}"
DRIVER_C_LAT="${DRIVER_C_LAT:--22.971100}"
DRIVER_C_LNG="${DRIVER_C_LNG:--43.182200}"

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
ARTIFACTS_ROOT="${ARTIFACTS_ROOT:-${ROOT_DIR}/reports/native-navigation-5x-ios-release-${TIMESTAMP}}"

NODE_BIN="${NODE_BIN:-$(command -v node)}"
SIMCTL_BIN="${SIMCTL_BIN:-/Library/Developer/PrivateFrameworks/CoreSimulator.framework/Versions/A/Resources/bin/simctl}"
SEED_AUTH_SCRIPT="${ROOT_DIR}/scripts/validation/lib/seed-sim-auth.cjs"
SEED_STATE_SCRIPT="${MOBILE_DIR}/scripts/qa/seed-prototype-ios-state.cjs"
READ_RUNTIME_SCRIPT="${ROOT_DIR}/scripts/validation/lib/read-sim-runtime-state.cjs"
QUEUE_HOME_AUTOMATION_SCRIPT="${ROOT_DIR}/scripts/validation/lib/queue-sim-home-automation.cjs"
GUARDED_IOS_LAUNCH_SCRIPT="${ROOT_DIR}/scripts/validation/lib/guarded-ios-launch.sh"
WAIT_DRIVER_AVAILABILITY_SCRIPT="${ROOT_DIR}/scripts/prelaunch/wait-driver-availability.cjs"
ENSURE_USERS_FILE="${MOBILE_DIR}/test-results/qa-preflight/ensure-users.json"
PASSENGER_REQUEST_RELEASE_FLOW="${MOBILE_DIR}/.maestro/flows/qa/e2e/lifecycle/02-passenger-request-copacabana-release-direct.yaml"
DRIVER_ACCEPT_OFFER_FLOW="${MOBILE_DIR}/.maestro/flows/qa/e2e/lifecycle/03-driver-accept-offer.yaml"
DRIVER_ARRIVE_FLOW="${MOBILE_DIR}/.maestro/flows/qa/e2e/lifecycle/04-driver-arrived.yaml"
DRIVER_START_FLOW="${MOBILE_DIR}/.maestro/flows/qa/e2e/lifecycle/05-driver-start-trip.yaml"
DRIVER_COMPLETE_FLOW="${MOBILE_DIR}/.maestro/flows/qa/e2e/lifecycle/06-driver-complete-trip.yaml"
PASSENGER_RATE_FLOW="${MOBILE_DIR}/.maestro/flows/qa/e2e/lifecycle/07-passenger-rate-trip.yaml"
DRIVER_RATE_PASSENGER_FLOW="${MOBILE_DIR}/.maestro/flows/qa/e2e/lifecycle/08-driver-rate-passenger.yaml"

export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
export PATH="${JAVA_HOME}/bin:${PATH}"
export API_BASE_URL WS_URL
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
  printf '[native-nav-5x] %s\n' "$*"
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

simctl_cmd() {
  "${SIMCTL_BIN}" "$@"
}

cleanup_maestro_processes() {
  pkill -f "maestro-driver-iosUITests-Runner" >/dev/null 2>&1 || true
  pkill -f "xcodebuild test-without-building.*maestro-driver-ios-config" >/dev/null 2>&1 || true
}

run_maestro_flow() {
  local udid="$1"
  local flow="$2"
  local output_dir="$3"
  local timeout_seconds="${4:-180}"
  mkdir -p "${output_dir}"
  cleanup_maestro_processes
  run_with_timeout "${timeout_seconds}" maestro test \
    --udid "${udid}" \
    --no-reinstall-driver \
    --debug-output "${output_dir}/debug-output" \
    --test-output-dir "${output_dir}" \
    "${flow}"
}

boot_device() {
  local udid="$1"
  if ! simctl_cmd list devices | grep -q "${udid}.*(Booted)"; then
    simctl_cmd boot "${udid}" >/dev/null 2>&1 || true
  fi
  while ! simctl_cmd list devices | grep -q "${udid}.*(Booted)"; do
    sleep 1
  done
}

install_app_once() {
  local udid="$1"
  boot_device "${udid}"
  run_with_timeout 10 simctl_cmd terminate "${udid}" "${APP_ID}" >/dev/null 2>&1 || true
  run_with_timeout 180 simctl_cmd install "${udid}" "${APP_PATH}"
  simctl_cmd spawn "${udid}" defaults write "${APP_ID}" EXDevMenuIsOnboardingFinished -bool YES >/dev/null 2>&1 || true
  simctl_cmd spawn "${udid}" defaults write "${APP_ID}" EXDevMenuShowsAtLaunch -bool NO >/dev/null 2>&1 || true
  run_with_timeout 10 simctl_cmd privacy "${udid}" grant location "${APP_ID}" >/dev/null 2>&1 || true
  run_with_timeout 10 simctl_cmd privacy "${udid}" grant location-always "${APP_ID}" >/dev/null 2>&1 || true
}

stop_external_leaf_sessions() {
  for udid in "${PASSENGER_UDID}" "${DRIVER_A_UDID}" "${DRIVER_B_UDID}" "${DRIVER_C_UDID}"; do
    run_with_timeout 10 simctl_cmd terminate "${udid}" "${APP_ID}" >/dev/null 2>&1 || true
  done

  if command -v adb >/dev/null 2>&1; then
    adb devices | awk 'NR > 1 && $2 == "device" { print $1 }' | while read -r serial; do
      [[ -n "${serial}" ]] || continue
      adb -s "${serial}" shell am force-stop "${APP_ID}" >/dev/null 2>&1 || true
    done
  fi
}

set_location() {
  run_with_timeout 15 simctl_cmd location "$1" set "$2,$3" >/dev/null 2>&1 || true
}

launch_home() {
  local udid="$1"
  local dir="$2"
  mkdir -p "${dir}"
  run_with_timeout 35 bash "${GUARDED_IOS_LAUNCH_SCRIPT}" "${udid}" "${APP_ID}" 8 "${dir}" >/dev/null 2>&1 || true
  run_with_timeout 15 simctl_cmd launch "${udid}" "${APP_ID}" >/dev/null 2>&1 || true
}

runtime_json() {
  local udid="$1"
  local output
  if output="$(run_with_timeout 12 "${NODE_BIN}" "${READ_RUNTIME_SCRIPT}" --udid "${udid}" --app-id "${APP_ID}" 2>/dev/null)"; then
    printf '%s' "${output}"
  else
    printf '{}'
  fi
}

runtime_field() {
  local udid="$1"
  local field="$2"
  runtime_json "${udid}" | "${NODE_BIN}" -e '
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

wait_runtime_predicate() {
  local udid="$1"
  local timeout_seconds="$2"
  local js_predicate="$3"
  local started_at
  started_at="$(date +%s)"
  while true; do
    if runtime_json "${udid}" | "${NODE_BIN}" -e '
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
  local udid="$1"
  local output="$2"
  simctl_cmd io "${udid}" screenshot "${output}" >/dev/null
}

capture_pair() {
  local run_dir="$1"
  local slug="$2"
  sleep "${3:-4}"
  capture_device "${PASSENGER_UDID}" "${run_dir}/${slug}-passenger.png" || true
  capture_device "${DRIVER_A_UDID}" "${run_dir}/${slug}-driver.png" || true
}

dismiss_ok() {
  local udid="$1"
  local run_dir="$2"
  local flow="${run_dir}/dismiss-ok.yaml"
  if [[ ! -f "${flow}" ]]; then
    cat > "${flow}" <<'YAML'
appId: br.com.leaf.ride
---
- runFlow:
    when:
      visible: "OK"
    commands:
      - tapOn: "OK"
YAML
  fi
  run_with_timeout 70 maestro test --udid "${udid}" --no-reinstall-driver "${flow}" >/dev/null 2>&1 || true
}

dismiss_open_leaf_prompt() {
  local udid="$1"
  local run_dir="$2"
  local flow="${run_dir}/dismiss-open-leaf.yaml"
  mkdir -p "${run_dir}"
  if [[ ! -f "${flow}" ]]; then
    cat > "${flow}" <<'YAML'
appId: br.com.leaf.ride
---
- tapOn: "Abrir"
YAML
  fi
  cleanup_maestro_processes
  run_with_timeout 25 maestro test --udid "${udid}" --no-reinstall-driver "${flow}" >/dev/null 2>&1 || true
  cleanup_maestro_processes
}

seed_auth_and_state() {
  local run_dir="$1"
  run_with_timeout 10 simctl_cmd terminate "${PASSENGER_UDID}" "${APP_ID}" >/dev/null 2>&1 || true
  run_with_timeout 10 simctl_cmd terminate "${DRIVER_A_UDID}" "${APP_ID}" >/dev/null 2>&1 || true
  if [[ "${RUN_EXTRA_DRIVERS}" == "1" ]]; then
    run_with_timeout 10 simctl_cmd terminate "${DRIVER_B_UDID}" "${APP_ID}" >/dev/null 2>&1 || true
    run_with_timeout 10 simctl_cmd terminate "${DRIVER_C_UDID}" "${APP_ID}" >/dev/null 2>&1 || true
  fi

  "${NODE_BIN}" "${SEED_AUTH_SCRIPT}" --udid "${PASSENGER_UDID}" --app-id "${APP_ID}" --role customer --profile-key passenger
  "${NODE_BIN}" "${SEED_AUTH_SCRIPT}" --udid "${DRIVER_A_UDID}" --app-id "${APP_ID}" --role driver --profile-key driver
  if [[ "${RUN_EXTRA_DRIVERS}" == "1" ]]; then
    "${NODE_BIN}" "${SEED_AUTH_SCRIPT}" --udid "${DRIVER_B_UDID}" --app-id "${APP_ID}" --role driver --profile-key driverTwo
    "${NODE_BIN}" "${SEED_AUTH_SCRIPT}" --udid "${DRIVER_C_UDID}" --app-id "${APP_ID}" --role driver --profile-key driverThree
  fi

  "${NODE_BIN}" "${SEED_STATE_SCRIPT}" --device "${PASSENGER_UDID}" --scenario passenger-home --uid "${PASSENGER_UID}" --artifact-dir "${run_dir}/state-passenger" --skip-launch --freeze-ms 0 --current-lat "${PICKUP_LAT}" --current-lng "${PICKUP_LNG}" --current-address "${PICKUP_LABEL}" >/dev/null
  "${NODE_BIN}" "${SEED_STATE_SCRIPT}" --device "${DRIVER_A_UDID}" --scenario driver-home --uid "${DRIVER_A_UID}" --artifact-dir "${run_dir}/state-driver-a" --skip-launch --freeze-ms 0 --current-lat "${DRIVER_A_LAT}" --current-lng "${DRIVER_A_LNG}" --current-address "Driver A staging point" >/dev/null
  if [[ "${RUN_EXTRA_DRIVERS}" == "1" ]]; then
    "${NODE_BIN}" "${SEED_STATE_SCRIPT}" --device "${DRIVER_B_UDID}" --scenario driver-home --uid "${DRIVER_B_UID}" --artifact-dir "${run_dir}/state-driver-b" --skip-launch --freeze-ms 0 --current-lat "${DRIVER_B_LAT}" --current-lng "${DRIVER_B_LNG}" --current-address "Driver B staging point" >/dev/null
    "${NODE_BIN}" "${SEED_STATE_SCRIPT}" --device "${DRIVER_C_UDID}" --scenario driver-home --uid "${DRIVER_C_UID}" --artifact-dir "${run_dir}/state-driver-c" --skip-launch --freeze-ms 0 --current-lat "${DRIVER_C_LAT}" --current-lng "${DRIVER_C_LNG}" --current-address "Driver C staging point" >/dev/null
  fi

  set_location "${PASSENGER_UDID}" "${PICKUP_LAT}" "${PICKUP_LNG}"
  set_location "${DRIVER_A_UDID}" "${DRIVER_A_LAT}" "${DRIVER_A_LNG}"
  if [[ "${RUN_EXTRA_DRIVERS}" == "1" ]]; then
    set_location "${DRIVER_B_UDID}" "${DRIVER_B_LAT}" "${DRIVER_B_LNG}"
    set_location "${DRIVER_C_UDID}" "${DRIVER_C_LAT}" "${DRIVER_C_LNG}"
  fi
}

driver_action() {
  local udid="$1"
  local action="$2"
  local nonce="$3"
  local booking_id="${4:-}"
  local queue_args=(--udid "${udid}" --app-id "${APP_ID}" --role driver --action "${action}" --nonce "${nonce}")
  local deeplink="leafapp://robotaxi/home?qaAutomation=1&qaDriverAction=${action}&qaNonce=${nonce}"
  if [[ -n "${booking_id}" ]]; then
    queue_args+=(--booking-id "${booking_id}")
    deeplink="${deeplink}&qaBookingId=${booking_id}"
  fi
  "${NODE_BIN}" "${QUEUE_HOME_AUTOMATION_SCRIPT}" "${queue_args[@]}"
  run_with_timeout 15 simctl_cmd openurl "${udid}" "${deeplink}" >/dev/null 2>&1 || true
  dismiss_open_leaf_prompt "${udid}" "${ARTIFACTS_ROOT}/ios-open-prompts/${nonce}" || true
}

passenger_action() {
  local udid="$1"
  local action="$2"
  local nonce="$3"
  local booking_id="${4:-}"
  local queue_args=(--udid "${udid}" --app-id "${APP_ID}" --role customer --action "${action}" --nonce "${nonce}")
  local deeplink="leafapp://robotaxi/home?qaAutomation=1&qaPassengerAction=${action}&qaNonce=${nonce}"
  if [[ -n "${booking_id}" ]]; then
    queue_args+=(--booking-id "${booking_id}")
    deeplink="${deeplink}&qaBookingId=${booking_id}"
  fi
  "${NODE_BIN}" "${QUEUE_HOME_AUTOMATION_SCRIPT}" "${queue_args[@]}"
  run_with_timeout 15 simctl_cmd openurl "${udid}" "${deeplink}" >/dev/null 2>&1 || true
  dismiss_open_leaf_prompt "${udid}" "${ARTIFACTS_ROOT}/ios-open-prompts/${nonce}" || true
}

passenger_request() {
  local nonce="$1"
  local _run_dir="$2"
  passenger_action "${PASSENGER_UDID}" request_seeded_destination "${nonce}"
}

run_rating_automation() {
  local udid="$1"
  local reviewer_type="$2"
  local expected_field="$3"
  local nonce="$4"

  for attempt in 1 2 3; do
    if [[ "${reviewer_type}" == "driver" ]]; then
      driver_action "${udid}" rate_last_receipt "${nonce}-${attempt}"
    else
      passenger_action "${udid}" rate_last_receipt "${nonce}-${attempt}"
    fi

    if wait_runtime_predicate "${udid}" 30 "Boolean(s.lastReceipt && s.lastReceipt.${expected_field})"; then
      return 0
    fi
    sleep 5
  done

  return 1
}

bring_driver_online() {
  local udid="$1"
  local label="$2"
  local run_dir="$3"
  launch_home "${udid}" "${run_dir}/launch-${label}"
  sleep 20
  wait_runtime_predicate "${udid}" 45 's.isSocketAuthenticated === true || s.isSocketConnected === true' || true
  for attempt in $(seq 1 "${ONLINE_DEEPLINK_ATTEMPTS}"); do
    log "${label}: online attempt ${attempt}"
    driver_action "${udid}" set_online "${label}-online-${attempt}-$(date +%s)"
    sleep 16
    runtime_json "${udid}" > "${run_dir}/${label}-online-attempt-${attempt}.json" || true
    if [[ "$(runtime_field "${udid}" driverOnline)" == "true" ]]; then
      log "${label}: online confirmed"
      return 0
    fi
    if (( attempt % 3 == 0 )); then
      launch_home "${udid}" "${run_dir}/launch-${label}-retry-${attempt}"
      sleep 8
    fi
  done

  log "${label}: deep link did not settle online; trying release UI fallback"
  run_with_timeout 120 maestro test \
    --udid "${udid}" \
    --no-reinstall-driver \
    "${MOBILE_DIR}/.maestro/flows/qa/e2e/lifecycle/01-driver-toggle-online.yaml" \
    > "${run_dir}/${label}-online-ui-fallback.log" 2>&1 || true
  sleep 20
  runtime_json "${udid}" > "${run_dir}/${label}-online-ui-fallback.json" || true
  if [[ "$(runtime_field "${udid}" driverOnline)" == "true" ]]; then
    log "${label}: online confirmed by UI fallback"
    return 0
  fi

  capture_device "${udid}" "${run_dir}/${label}-online-timeout.png" || true
  runtime_json "${udid}" > "${run_dir}/${label}-online-timeout.json" || true
  return 1
}

wait_driver_available_for_passenger_request() {
  local udid="$1"
  local label="$2"
  local driver_uid="$3"
  local run_dir="$4"
  local timeline="$5"
  local output_file="${run_dir}/${label}-availability-before-passenger-request.json"

  log "${label}: waiting backend availability before passenger request"
  if "${NODE_BIN}" "${WAIT_DRIVER_AVAILABILITY_SCRIPT}" \
    --api-base-url "${API_BASE_URL}" \
    --driver-uid "${driver_uid}" \
    --lat "${PICKUP_LAT}" \
    --lng "${PICKUP_LNG}" \
    --driver-lat "${DRIVER_A_LAT}" \
    --driver-lng "${DRIVER_A_LNG}" \
    --radius-km 10 \
    --timeout-ms 90000 \
    --repair-after-ms 15000 \
    --output "${output_file}" \
    > "${run_dir}/${label}-availability-before-passenger-request.log" 2>&1; then
    append_timeline "${timeline}" driver_available_for_request "$(jq -c \
      '{driverReady,repaired,count,matchedDriver}' \
      "${output_file}" 2>/dev/null || printf '{}')"
    return 0
  fi

  runtime_json "${udid}" > "${run_dir}/${label}-runtime-availability-timeout.json" || true
  capture_device "${udid}" "${run_dir}/${label}-availability-timeout.png" || true
  append_timeline "${timeline}" driver_availability_failed "$(jq -c \
    --slurpfile availability "${output_file}" \
    --slurpfile runtime "${run_dir}/${label}-runtime-availability-timeout.json" \
    '{availability:($availability[0] // {}), runtime:($runtime[0] // {})}')"
  return 1
}

wait_booking_created() {
  wait_runtime_predicate "${PASSENGER_UDID}" 180 'Boolean(s.activeBookingId) && s.activeBookingId !== "null"'
}

wait_driver_status() {
  local expected="$1"
  wait_runtime_predicate "${DRIVER_A_UDID}" 180 "s.bookingStatus === \"${expected}\""
}

wait_passenger_status() {
  local expected="$1"
  wait_runtime_predicate "${PASSENGER_UDID}" 180 "s.bookingStatus === \"${expected}\""
}

driver_distance_to_pickup_meters() {
  runtime_json "${DRIVER_A_UDID}" | "${NODE_BIN}" -e '
    let raw = "";
    process.stdin.on("data", d => raw += d);
    process.stdin.on("end", () => {
      let s = {};
      try { s = JSON.parse(raw || "{}"); } catch (_) {}
      const current =
        s.currentCoordinate ||
        s.driverCoordinate ||
        s.driverActiveRide?.driverCoordinate ||
        null;
      const pickup =
        s.driverTripMeta?.pickupCoordinate ||
        s.driverActiveRide?.pickupCoordinate ||
        s.activeBooking?.pickupLocation ||
        null;
      const lat1 = Number(current?.latitude ?? current?.lat);
      const lon1 = Number(current?.longitude ?? current?.lng);
      const lat2 = Number(pickup?.latitude ?? pickup?.lat);
      const lon2 = Number(pickup?.longitude ?? pickup?.lng);
      if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) {
        process.stdout.write("");
        return;
      }
      const rad = Math.PI / 180;
      const earthMeters = 6371000;
      const dLat = (lat2 - lat1) * rad;
      const dLon = (lon2 - lon1) * rad;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
      const meters = 2 * earthMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      process.stdout.write(String(Math.round(meters)));
    });
  '
}

wait_driver_near_pickup() {
  local timeout_seconds="${1:-300}"
  local threshold_meters="${2:-140}"
  local out_file="${3:-}"
  local started_at
  local last_logged_bucket="-1"
  local meters=""
  started_at="$(date +%s)"

  while true; do
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

    local elapsed=$(( $(date +%s) - started_at ))
    local bucket=$(( elapsed / 30 ))
    if [[ "${bucket}" != "${last_logged_bucket}" ]]; then
      log "waiting driver near pickup: ${meters:-unknown}m, threshold ${threshold_meters}m"
      last_logged_bucket="${bucket}"
    fi

    if (( elapsed >= timeout_seconds )); then
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
  launch_home "${PASSENGER_UDID}" "${run_dir}/launch-passenger"
  launch_home "${DRIVER_A_UDID}" "${run_dir}/launch-driver-a"
  if [[ "${RUN_EXTRA_DRIVERS}" == "1" ]]; then
    launch_home "${DRIVER_B_UDID}" "${run_dir}/launch-driver-b"
    launch_home "${DRIVER_C_UDID}" "${run_dir}/launch-driver-c"
  fi
  capture_pair "${run_dir}" "00-home-warmed" 3
  append_timeline "${timeline}" apps_warmed

  log "run ${index}: bringing drivers online"
  if ! bring_driver_online "${DRIVER_A_UDID}" driver-a "${run_dir}"; then
    append_timeline "${timeline}" driver_online_failed "$(jq -nc \
      --slurpfile state "${run_dir}/driver-a-online-timeout.json" \
      '{driverA:($state[0] // {})}')"
    return 1
  fi
  if [[ "${RUN_EXTRA_DRIVERS}" == "1" ]]; then
    bring_driver_online "${DRIVER_B_UDID}" driver-b "${run_dir}" || return 1
    bring_driver_online "${DRIVER_C_UDID}" driver-c "${run_dir}" || return 1
  fi
  wait_driver_available_for_passenger_request "${DRIVER_A_UDID}" driver-a "${DRIVER_A_UID}" "${run_dir}" "${timeline}" || return 1
  capture_pair "${run_dir}" "01-drivers-online" 4
  local driver_b_online=""
  local driver_c_online=""
  if [[ "${RUN_EXTRA_DRIVERS}" == "1" ]]; then
    driver_b_online="$(runtime_field "${DRIVER_B_UDID}" driverOnline)"
    driver_c_online="$(runtime_field "${DRIVER_C_UDID}" driverOnline)"
  fi
  append_timeline "${timeline}" drivers_online "$(jq -nc \
    --arg a "$(runtime_field "${DRIVER_A_UDID}" driverOnline)" \
    --arg b "${driver_b_online}" \
    --arg c "${driver_c_online}" \
    '{driverA:$a,driverB:$b,driverC:$c}')"

  log "run ${index}: passenger requesting ride"
  launch_home "${PASSENGER_UDID}" "${run_dir}/launch-passenger-request"
  passenger_request "request-${index}-$(date +%s)" "${run_dir}"
  wait_booking_created
  local booking_id
  booking_id="$(runtime_field "${PASSENGER_UDID}" activeBookingId)"
  capture_pair "${run_dir}" "02-ride-requested" 6
  append_timeline "${timeline}" ride_requested "{\"bookingId\":\"${booking_id}\"}"

  log "run ${index}: driver accepting"
  if [[ "${DRIVER_ACTION_MODE}" == "maestro" ]]; then
    run_maestro_flow \
      "${DRIVER_A_UDID}" \
      "${DRIVER_ACCEPT_OFFER_FLOW}" \
      "${run_dir}/driver-accept-flow" \
      180
  else
    driver_action "${DRIVER_A_UDID}" accept_offer "accept-${index}-$(date +%s)" "${booking_id}"
  fi
  wait_driver_status accepted
  wait_passenger_status accepted
  capture_pair "${run_dir}" "03-driver-accepted-native-navigation" 8
  append_timeline "${timeline}" driver_accepted "{\"bookingId\":\"${booking_id}\"}"

  sleep 20
  capture_pair "${run_dir}" "04-enroute-to-pickup-navigation" 2
  append_timeline "${timeline}" enroute_to_pickup_evidence "{\"waitBeforeArriveSeconds\":${PICKUP_APPROACH_WAIT_SECONDS}}"

  log "run ${index}: waiting ${PICKUP_APPROACH_WAIT_SECONDS}s for 50km/h mocked approach before arrival"
  sleep "${PICKUP_APPROACH_WAIT_SECONDS}"
  launch_home "${DRIVER_A_UDID}" "${run_dir}/launch-driver-before-arrive"
  sleep 8
  wait_driver_near_pickup 300 140 "${run_dir}/driver-distance-to-pickup.jsonl"
  capture_pair "${run_dir}" "04b-at-pickup-before-arrival" 1

  log "run ${index}: arrive/start/complete"
  if [[ "${DRIVER_ACTION_MODE}" == "maestro" ]]; then
    run_maestro_flow \
      "${DRIVER_A_UDID}" \
      "${DRIVER_ARRIVE_FLOW}" \
      "${run_dir}/driver-arrive-flow" \
      180
  else
    driver_action "${DRIVER_A_UDID}" arrive_pickup "arrive-${index}-$(date +%s)" "${booking_id}"
  fi
  wait_driver_status arrived
  wait_passenger_status arrived
  capture_pair "${run_dir}" "05-driver-arrived" 5

  if [[ "${DRIVER_ACTION_MODE}" == "maestro" ]]; then
    run_maestro_flow \
      "${DRIVER_A_UDID}" \
      "${DRIVER_START_FLOW}" \
      "${run_dir}/driver-start-flow" \
      180
  else
    driver_action "${DRIVER_A_UDID}" start_trip "start-${index}-$(date +%s)" "${booking_id}"
  fi
  wait_driver_status started
  wait_passenger_status started
  capture_pair "${run_dir}" "06-trip-started-native-navigation" 8

  sleep 30
  launch_home "${DRIVER_A_UDID}" "${run_dir}/launch-driver-before-complete"
  sleep 5
  capture_pair "${run_dir}" "07-trip-in-progress-navigation" 2

  if [[ "${DRIVER_ACTION_MODE}" == "maestro" ]]; then
    run_maestro_flow \
      "${DRIVER_A_UDID}" \
      "${DRIVER_COMPLETE_FLOW}" \
      "${run_dir}/driver-complete-flow" \
      180
  else
    driver_action "${DRIVER_A_UDID}" complete_trip "complete-${index}-$(date +%s)" "${booking_id}"
  fi
  wait_passenger_status completed
  wait_runtime_predicate "${DRIVER_A_UDID}" 180 's.bookingStatus === "completed" || s.bookingStatus === "idle"'
  capture_pair "${run_dir}" "08-trip-completed" 6

  log "run ${index}: rating cycle"
  passenger_action "${PASSENGER_UDID}" open_receipt "passenger-receipt-${index}-$(date +%s)" "${booking_id}"
  sleep 5
  run_rating_automation \
    "${PASSENGER_UDID}" \
    "passenger" \
    "passengerRatedDriverAt" \
    "passenger-rating-${index}-$(date +%s)"
  run_rating_automation \
    "${DRIVER_A_UDID}" \
    "driver" \
    "driverRatedPassengerAt" \
    "driver-rating-${index}-$(date +%s)"
  capture_pair "${run_dir}" "09-rating-cycle" 4

  runtime_json "${PASSENGER_UDID}" > "${run_dir}/passenger-runtime-final.json"
  runtime_json "${DRIVER_A_UDID}" > "${run_dir}/driver-runtime-final.json"
  run_with_timeout 12 "${NODE_BIN}" "${ROOT_DIR}/scripts/validation/lib/read-sim-ride-cost-telemetry.cjs" --udid "${PASSENGER_UDID}" --app-id "${APP_ID}" --booking-id "${booking_id}" > "${run_dir}/sim-ride-cost-telemetry.json" 2>/dev/null || true
  run_with_timeout 20 bash -lc "cd \"${BACKEND_DIR}\" && \"${NODE_BIN}\" scripts/tests/report-ride-cost-telemetry.cjs \"${booking_id}\"" > "${run_dir}/ride-cost-telemetry.json" 2>/dev/null || true

  local driver_status passenger_status receipt_id driver_online passenger_rating_at driver_rating_at driver_receipt_id
  local passenger_final_fare driver_final_fare passenger_driver_net driver_driver_net passenger_total_fees driver_total_fees
  passenger_status="$(runtime_field "${PASSENGER_UDID}" bookingStatus)"
  driver_status="$(runtime_field "${DRIVER_A_UDID}" bookingStatus)"
  driver_online="$(runtime_field "${DRIVER_A_UDID}" driverOnline)"
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

if [[ ! -d "${APP_PATH}" ]]; then
  log "Release app not found: ${APP_PATH}"
  exit 1
fi

log "artifacts: ${ARTIFACTS_ROOT}"
printf '%s\n' "${ARTIFACTS_ROOT}" > "${ROOT_DIR}/tmp-evidence/latest-native-navigation-5x-ios-release-dir.txt"

log "stopping old Leaf sessions on simulators/emulators"
stop_external_leaf_sessions

log "installing Release app once"
install_app_once "${PASSENGER_UDID}"
install_app_once "${DRIVER_A_UDID}"
if [[ "${RUN_EXTRA_DRIVERS}" == "1" ]]; then
  install_app_once "${DRIVER_B_UDID}"
  install_app_once "${DRIVER_C_UDID}"
fi

log "ensuring test users"
TEST_DRIVER_THREE_PHONE="${TEST_DRIVER_THREE_PHONE:-11888888890}" \
  "${NODE_BIN}" "${BACKEND_DIR}/scripts/tests/ensure-leaf-test-users.cjs" \
  > "${ENSURE_USERS_FILE}"
PASSENGER_UID="$(jq -r '.passenger.uid' "${ENSURE_USERS_FILE}")"
DRIVER_A_UID="$(jq -r '.driver.uid' "${ENSURE_USERS_FILE}")"
DRIVER_B_UID="$(jq -r '.driverTwo.uid' "${ENSURE_USERS_FILE}")"
DRIVER_C_UID="$(jq -r '.driverThree.uid' "${ENSURE_USERS_FILE}")"
jq '{passenger:.passenger.uid,driverA:.driver.uid,driverB:.driverTwo.uid,driverC:.driverThree.uid}' "${ENSURE_USERS_FILE}" > "${ARTIFACTS_ROOT}/users.json"

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
