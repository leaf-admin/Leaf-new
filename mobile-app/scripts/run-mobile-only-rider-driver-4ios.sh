#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MOBILE_DIR="${ROOT_DIR}/mobile-app"
BACKEND_DIR="${ROOT_DIR}/leaf-websocket-backend"

PASSENGER_UDID="${PASSENGER_UDID:-195D2C57-87DC-4953-ABF1-4FD351ADBBEF}"
DRIVER_A_UDID="${DRIVER_A_UDID:-2E44BC8E-9AA8-43BE-BD5E-D0B5A73E543C}"
DRIVER_B_UDID="${DRIVER_B_UDID:-77B44D4A-7D05-4FC2-A84F-0B10715CC37F}"
DRIVER_C_UDID="${DRIVER_C_UDID:-BB96BE67-2C24-47BA-BFFB-199E72CA2E94}"

APP_ID="${APP_ID:-br.com.leaf.ride}"
APP_PATH="${APP_PATH:-}"
APP_LAUNCH_MODE="${APP_LAUNCH_MODE:-dev-client}"
METRO_HOST="${METRO_HOST:-127.0.0.1}"
METRO_PORT="${METRO_PORT:-8081}"

API_BASE_URL="${API_BASE_URL:-https://api.62.169.31.231.sslip.io}"
WS_URL="${WS_URL:-https://socket.62.169.31.231.sslip.io}"
DO_HOST="${DO_HOST:-62.169.31.231}"
DO_KEY="${DO_KEY:-${ROOT_DIR}/digitaloceankey}"
DO_REMOTE_ENV_PATH="${DO_REMOTE_ENV_PATH:-/opt/leaf-app/.env}"
PLAYBACK_SPEED_MPS="${PLAYBACK_SPEED_MPS:-16.667}"
PLAYBACK_QA_MULTIPLIER="${PLAYBACK_QA_MULTIPLIER:-1}"
APPROACH_EVIDENCE_WAIT_SECONDS="${APPROACH_EVIDENCE_WAIT_SECONDS:-20}"
FLOW_SETTLE_SECONDS="${FLOW_SETTLE_SECONDS:-8}"
DRIVER_DISPATCH_READY_TIMEOUT_SECONDS="${DRIVER_DISPATCH_READY_TIMEOUT_SECONDS:-120}"
MATCH_DRIVERS_PER_WAVE="${MATCH_DRIVERS_PER_WAVE:-3}"
MATCH_RESPONSE_PAUSE_MIN_UNIQUE_DRIVERS="${MATCH_RESPONSE_PAUSE_MIN_UNIQUE_DRIVERS:-3}"
DISPATCH_DRIVER_RESPONSE_TIMEOUT_SECONDS="${DISPATCH_DRIVER_RESPONSE_TIMEOUT_SECONDS:-300}"
OFFER_RESERVATION_TTL_SECONDS="${OFFER_RESERVATION_TTL_SECONDS:-300}"
DISPATCH_DRIVER_LIVENESS_GRACE_MS="${DISPATCH_DRIVER_LIVENESS_GRACE_MS:-300000}"
DRIVER_DISCONNECT_GRACE_MS="${DRIVER_DISCONNECT_GRACE_MS:-300000}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
ARTIFACTS_DIR="${ARTIFACTS_DIR:-${ROOT_DIR}/reports/mobile-only-rider-driver-4ios_${TIMESTAMP}}"
METRO_LOG="${ARTIFACTS_DIR}/metro.log"
ENSURE_USERS_FILE="${MOBILE_DIR}/test-results/qa-preflight/ensure-users.json"
RUNTIME_STATUS_DIR="${ARTIFACTS_DIR}/runtime"
DRIVER_STATUS_DIR="${ARTIFACTS_DIR}/driver-status"
SHARED_DEV_CLIENT_MARKER_DIR="${ROOT_DIR}/reports/.dev-client-markers"
PROM_BEFORE_FILE="${ARTIFACTS_DIR}/prometheus-before.txt"
PROM_AFTER_FILE="${ARTIFACTS_DIR}/prometheus-after.txt"
TIMELINE_FILE="${ARTIFACTS_DIR}/timeline.jsonl"

SEED_AUTH_SCRIPT="${ROOT_DIR}/scripts/validation/lib/seed-sim-auth.cjs"
SEED_STATE_SCRIPT="${MOBILE_DIR}/scripts/qa/seed-prototype-ios-state.cjs"
READ_RUNTIME_SCRIPT="${ROOT_DIR}/scripts/validation/lib/read-sim-runtime-state.cjs"
READ_COST_SCRIPT="${ROOT_DIR}/scripts/validation/lib/read-sim-ride-cost-telemetry.cjs"
TOKEN_HELPER="${ROOT_DIR}/scripts/validation/lib/get-admin-bearer-token.sh"
GUARDED_IOS_LAUNCH_SCRIPT="${ROOT_DIR}/scripts/validation/lib/guarded-ios-launch.sh"
QUEUE_HOME_AUTOMATION_SCRIPT="${ROOT_DIR}/scripts/validation/lib/queue-sim-home-automation.cjs"
ACCEPT_OPEN_PROMPT_FLOW="${MOBILE_DIR}/.maestro/flows/qa/_accept-open-prompt.yaml"
ACCEPT_OPEN_PROMPT_NO_LAUNCH_FLOW="${MOBILE_DIR}/.maestro/flows/qa/_accept-open-prompt-no-launch.yaml"
EXPO_ENV_LOCAL_FILE="${MOBILE_DIR}/.env.local"
EXPO_ENV_LOCAL_BACKUP="${ARTIFACTS_DIR}/.env.local.backup"

export MAESTRO_METRO_HOST="${METRO_HOST}"
export MAESTRO_METRO_PORT="${METRO_PORT}"

PICKUP_LABEL="Estrada do Rio Grande 4057, Taquara, Rio de Janeiro"
DESTINATION_LABEL="Copacabana Palace"
PICKUP_LAT="-22.9190889"
PICKUP_LNG="-43.4066990"
DEST_LAT="-22.9670133"
DEST_LNG="-43.1791849"
DRIVER_A_LAT="-22.912730"
DRIVER_A_LNG="-43.399795"
DRIVER_B_LAT="-22.919088"
DRIVER_B_LNG="-43.387171"
DRIVER_C_LAT="-22.944523"
DRIVER_C_LNG="-43.379077"

mkdir -p "${ARTIFACTS_DIR}" "${RUNTIME_STATUS_DIR}" "${DRIVER_STATUS_DIR}" "${SHARED_DEV_CLIENT_MARKER_DIR}" "$(dirname "${ENSURE_USERS_FILE}")"
: > "${TIMELINE_FILE}"

log() {
  printf "[mobile-only-4ios] %s\n" "$1"
}

resolve_app_path() {
  if [[ -n "${APP_PATH}" ]]; then
    return 0
  fi

  local release_app="${MOBILE_DIR}/ios/build/Build/Products/Release-iphonesimulator/Leaf.app"
  local debug_app="${MOBILE_DIR}/ios/build/Build/Products/Debug-iphonesimulator/Leaf.app"

  if [[ -d "${release_app}" && -d "${debug_app}" ]]; then
    if [[ "${release_app}" -nt "${debug_app}" ]]; then
      APP_PATH="${release_app}"
    else
      APP_PATH="${debug_app}"
    fi
    return 0
  fi

  if [[ -d "${release_app}" ]]; then
    APP_PATH="${release_app}"
    return 0
  fi

  if [[ -d "${debug_app}" ]]; then
    APP_PATH="${debug_app}"
    return 0
  fi
}

restore_local_expo_env() {
  if [[ -f "${EXPO_ENV_LOCAL_BACKUP}" ]]; then
    mv "${EXPO_ENV_LOCAL_BACKUP}" "${EXPO_ENV_LOCAL_FILE}"
    return 0
  fi

  if [[ -f "${EXPO_ENV_LOCAL_FILE}" ]] && grep -q "codex-local-e2e" "${EXPO_ENV_LOCAL_FILE}" 2>/dev/null; then
    rm -f "${EXPO_ENV_LOCAL_FILE}"
  fi
}

prepare_local_expo_env() {
  if [[ -f "${EXPO_ENV_LOCAL_FILE}" && ! -f "${EXPO_ENV_LOCAL_BACKUP}" ]]; then
    cp "${EXPO_ENV_LOCAL_FILE}" "${EXPO_ENV_LOCAL_BACKUP}"
  fi

  cat > "${EXPO_ENV_LOCAL_FILE}" <<EOF
# codex-local-e2e
EXPO_PUBLIC_API_URL=${API_BASE_URL}
EXPO_PUBLIC_BACKEND_URL=${API_BASE_URL}
EXPO_PUBLIC_WS_URL=${WS_URL}
EXPO_PUBLIC_SOCKET_URL=${WS_URL}
EXPO_PUBLIC_FORCE_PAYMENT_BYPASS=true
EXPO_PUBLIC_ALLOW_INSECURE_HTTP=true
EOF
}

seed_driver_daily_kyc() {
  local driver_uid="$1"
  local label="${2:-driver}"
  local response_file="${ARTIFACTS_DIR}/driver-status/kyc-seed-${label}.json"
  local http_code=""

  http_code="$(curl -sS -o "${response_file}" -w "%{http_code}" \
    -X POST "${API_BASE_URL}/api/kyc/verify-driver" \
    -H "Content-Type: application/json" \
    -d "$(jq -nc --arg userId "${driver_uid}" '{
      userId: $userId,
      deviceKyc: {
        isMatch: true,
        similarityScore: 0.99,
        confidence: 0.99,
        threshold: 0.75,
        processingTime: 1200,
        mode: "device_signature_v1"
      }
    }')")"

  if [[ "${http_code}" != "200" ]] || ! jq -e '.success == true' "${response_file}" >/dev/null 2>&1; then
    log "failed to seed daily KYC for ${label} (http ${http_code:-000})"
    cat "${response_file}" >/dev/null 2>&1 || true
    return 1
  fi

  log "seeded daily KYC for ${label}"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log "missing command: $1"
    exit 1
  fi
}

for cmd in node jq xcrun maestro bash curl lsof; do
  require_cmd "$cmd"
done

NODE_BIN="$(command -v node)"

resolve_driver_status_token() {
  local env_file="${BACKEND_DIR}/.tmp-contabo.env"

  if [[ -n "${DRIVER_STATUS_DEBUG_TOKEN:-}" ]]; then
    printf '%s\n' "${DRIVER_STATUS_DEBUG_TOKEN}"
    return 0
  fi

  if [[ ! -f "${env_file}" ]]; then
    return 1
  fi

  awk -F= '
    /^(DRIVER_STATUS_DEBUG_TOKEN|RUNTIME_ADMIN_TOKEN|RESTART_TOKEN)=/ {
      value = substr($0, index($0, "=") + 1);
      if (length(value) > 0) {
        print value;
        exit 0;
      }
    }
  ' "${env_file}"
}

AUTO_DRIVER_STATUS_TOKEN="$(resolve_driver_status_token 2>/dev/null || true)"
if [[ -n "${AUTO_DRIVER_STATUS_TOKEN}" && -z "${DRIVER_STATUS_DEBUG_TOKEN:-}" ]]; then
  export DRIVER_STATUS_DEBUG_TOKEN="${AUTO_DRIVER_STATUS_TOKEN}"
fi

if [[ ! -d "${APP_PATH}" ]]; then
  resolve_app_path
fi

if [[ ! -d "${APP_PATH}" ]]; then
  log "app not found at ${APP_PATH}"
  exit 1
fi

if [[ ! -f "${DO_KEY}" ]]; then
  log "missing DigitalOcean key at ${DO_KEY}"
  exit 1
fi

append_timeline() {
  local stage="$1"
  local details="${2:-{}}"
  "${NODE_BIN}" -e '
    const fs = require("fs");
    const file = process.argv[1];
    const stage = process.argv[2];
    let details = {};
    try { details = JSON.parse(process.argv[3] || "{}"); } catch (_) {}
    fs.appendFileSync(file, JSON.stringify({ stage, at: new Date().toISOString(), details }) + "\n");
  ' "${TIMELINE_FILE}" "${stage}" "${details}"
}

list_descendant_pids() {
  local parent_pid="$1"
  local child_pid=""
  while IFS= read -r child_pid; do
    [[ -n "${child_pid}" ]] || continue
    list_descendant_pids "${child_pid}"
    printf '%s\n' "${child_pid}"
  done < <(pgrep -P "${parent_pid}" 2>/dev/null || true)
}

terminate_process_tree() {
  local root_pid="$1"
  local signal="${2:-TERM}"
  local child_pid=""

  [[ -n "${root_pid}" ]] || return 0

  while IFS= read -r child_pid; do
    [[ -n "${child_pid}" ]] || continue
    kill "-${signal}" "${child_pid}" >/dev/null 2>&1 || true
  done < <(list_descendant_pids "${root_pid}")

  kill "-${signal}" "${root_pid}" >/dev/null 2>&1 || true
}

run_with_timeout() {
  local timeout_seconds="$1"
  shift
  local cmd_desc="$*"
  "$@" &
  local cmd_pid=$!
  local started_at
  started_at="$(date +%s)"

  while kill -0 "${cmd_pid}" >/dev/null 2>&1; do
    if (( $(date +%s) - started_at >= timeout_seconds )); then
      log "timeout after ${timeout_seconds}s: ${cmd_desc}"
      append_timeline "timeout" "$(jq -nc --arg command "${cmd_desc}" --arg timeoutSeconds "${timeout_seconds}" '{command: $command, timeoutSeconds: ($timeoutSeconds | tonumber)}')"
      terminate_process_tree "${cmd_pid}" TERM
      sleep 2
      terminate_process_tree "${cmd_pid}" KILL
      if [[ "${cmd_desc}" == *"maestro "* ]]; then
        cleanup_maestro_processes
      fi
      wait "${cmd_pid}" >/dev/null 2>&1 || true
      return 124
    fi
    sleep 1
  done

  wait "${cmd_pid}"
}

metro_is_listening() {
  lsof -nP -iTCP:"${METRO_PORT}" -sTCP:LISTEN >/dev/null 2>&1
}

wait_http_ready() {
  local url="$1"
  local label="$2"
  local started_at
  started_at="$(date +%s)"
  while true; do
    if curl -fsS -m 5 "${url}" >/dev/null 2>&1; then
      log "${label} ready"
      return 0
    fi
    if (( $(date +%s) - started_at >= 180 )); then
      log "${label} did not become ready"
      return 1
    fi
    sleep 2
  done
}

ensure_metro() {
  if [[ "${APP_LAUNCH_MODE}" == "direct" ]]; then
    return 0
  fi

  if metro_is_listening; then
    log "metro already listening on ${METRO_PORT}"
    return 0
  fi

  log "starting Expo dev client metro on port ${METRO_PORT}"
  (
    cd "${MOBILE_DIR}"
    EXPO_PUBLIC_E2E_TEST=1 \
    EXPO_PUBLIC_API_URL="${API_BASE_URL}" \
    EXPO_PUBLIC_BACKEND_URL="${API_BASE_URL}" \
    EXPO_PUBLIC_WS_URL="${WS_URL}" \
    EXPO_PUBLIC_SOCKET_URL="${WS_URL}" \
    EXPO_PUBLIC_FORCE_PAYMENT_BYPASS=true \
    EXPO_PUBLIC_ALLOW_INSECURE_HTTP=true \
    EXPO_PUBLIC_PROTOTYPE_PICKUP_SPEED_MPS="${PLAYBACK_SPEED_MPS}" \
    EXPO_PUBLIC_PROTOTYPE_TRIP_SPEED_MPS="${PLAYBACK_SPEED_MPS}" \
    EXPO_PUBLIC_PROTOTYPE_ROUTE_PLAYBACK_QA_MULTIPLIER="${PLAYBACK_QA_MULTIPLIER}" \
    npx expo start --dev-client --port "${METRO_PORT}" --host localhost --clear \
      > "${METRO_LOG}" 2>&1
  ) &

  wait_http_ready "http://${METRO_HOST}:${METRO_PORT}" "metro"
  if ! curl -fsS "http://${METRO_HOST}:${METRO_PORT}/status" >/dev/null 2>&1; then
    log "metro status probe unavailable; continuing with root health only"
  fi
}

ensure_simulator_window() {
  open -a Simulator >/dev/null 2>&1 || true
}

boot_device() {
  local udid="$1"
  local started_at
  started_at="$(date +%s)"

  if ! xcrun simctl list devices | grep -q "${udid}.*(Booted)"; then
    xcrun simctl boot "${udid}" >/dev/null 2>&1 || true
  fi

  while ! xcrun simctl list devices | grep -q "${udid}.*(Booted)"; do
    if (( $(date +%s) - started_at >= 60 )); then
      log "device ${udid} did not reach Booted state"
      return 1
    fi
    sleep 2
  done
}

grant_location_permissions() {
  local udid="$1"
  run_with_timeout 10 xcrun simctl privacy "${udid}" grant location "${APP_ID}" >/dev/null 2>&1 || true
  run_with_timeout 10 xcrun simctl privacy "${udid}" grant location-always "${APP_ID}" >/dev/null 2>&1 || true
}

set_device_location() {
  local udid="$1"
  local latitude="$2"
  local longitude="$3"
  run_with_timeout 15 xcrun simctl location "${udid}" set "${latitude},${longitude}" >/dev/null 2>&1 || true
}

open_url() {
  local udid="$1"
  local url="$2"
  run_with_timeout 10 xcrun simctl openurl "${udid}" "${url}" >/dev/null || true
}

dev_client_marker_path() {
  local udid="$1"
  printf '%s\n' "${SHARED_DEV_CLIENT_MARKER_DIR}/${udid}.attached"
}

foreground_app() {
  local udid="$1"
  local settle_seconds="${2:-${FLOW_SETTLE_SECONDS}}"
  local launch_artifacts_dir="${ARTIFACTS_DIR}/_launch_watch/${udid}"
  local dev_client_marker
  local dev_client_url
  local direct_home_url
  mkdir -p "${launch_artifacts_dir}"
  direct_home_url="leafapp://robotaxi/home?qaAutomation=1&qaNonce=foreground-${udid}"

  if [[ "${APP_LAUNCH_MODE}" == "direct" ]]; then
    run_with_timeout 10 xcrun simctl terminate "${udid}" "${APP_ID}" >/dev/null 2>&1 || true
    run_with_timeout $((settle_seconds + 20)) \
      xcrun simctl launch "${udid}" "${APP_ID}" >/dev/null || true
    sleep 2
    run_with_timeout 10 xcrun simctl openurl "${udid}" "${direct_home_url}" >/dev/null || true
    run_with_timeout 20 maestro test "${ACCEPT_OPEN_PROMPT_FLOW}" \
      --udid "${udid}" \
      --no-reinstall-driver \
      --test-output-dir "${ARTIFACTS_DIR}/accept-open-${udid}" >/dev/null || true
    sleep "${settle_seconds}"
    return 0
  fi

  run_with_timeout $((settle_seconds + 15)) \
    bash "${GUARDED_IOS_LAUNCH_SCRIPT}" "${udid}" "${APP_ID}" "${settle_seconds}" "${launch_artifacts_dir}" >/dev/null || true

  dev_client_marker="$(dev_client_marker_path "${udid}")"
  if [[ ! -f "${dev_client_marker}" ]]; then
    dev_client_url="exp+leafapp-reactnative://expo-development-client/?url=$("${NODE_BIN}" -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "http://${METRO_HOST}:${METRO_PORT}")"
    direct_home_url="leafapp://robotaxi/home?qaAutomation=1&qaNonce=dev-client-${udid}"
    run_with_timeout 10 xcrun simctl openurl "${udid}" "${dev_client_url}" >/dev/null || true
    run_with_timeout 45 maestro test "${ACCEPT_OPEN_PROMPT_FLOW}" \
      --udid "${udid}" \
      --no-reinstall-driver \
      --test-output-dir "${ARTIFACTS_DIR}/dev-client-open-${udid}" >/dev/null || true
    run_with_timeout 10 xcrun simctl openurl "${udid}" "${direct_home_url}" >/dev/null || true
    touch "${dev_client_marker}"
  fi

  run_with_timeout 10 xcrun simctl openurl "${udid}" "${direct_home_url}" >/dev/null || true
  run_with_timeout 20 maestro test "${ACCEPT_OPEN_PROMPT_NO_LAUNCH_FLOW}" \
    --udid "${udid}" \
    --no-reinstall-driver \
    --test-output-dir "${ARTIFACTS_DIR}/accept-open-${udid}" >/dev/null || true

  sleep "${settle_seconds}"
}

run_driver_action() {
  local udid="$1"
  local action="$2"
  local nonce="$3"
  local reuse_running_app="${4:-false}"
  local role="driver"
  if [[ "${udid}" == "${PASSENGER_UDID}" ]]; then
    role="customer"
  fi
  if [[ "${reuse_running_app}" != "true" ]]; then
    foreground_app "${udid}" "${FLOW_SETTLE_SECONDS}"
  fi
  "${NODE_BIN}" "${QUEUE_HOME_AUTOMATION_SCRIPT}" \
    --udid "${udid}" \
    --app-id "${APP_ID}" \
    --role "${role}" \
    --action "${action}" \
    --nonce "${nonce}" >/dev/null 2>&1 || true
  open_url "${udid}" "leafapp://robotaxi/home?qaAutomation=1&qaDriverAction=${action}&qaNonce=${nonce}"
  sleep "${FLOW_SETTLE_SECONDS}"
}

run_passenger_action() {
  local action="$1"
  local nonce="$2"
  foreground_app "${PASSENGER_UDID}" "${FLOW_SETTLE_SECONDS}"
  "${NODE_BIN}" "${QUEUE_HOME_AUTOMATION_SCRIPT}" \
    --udid "${PASSENGER_UDID}" \
    --app-id "${APP_ID}" \
    --role customer \
    --action "${action}" \
    --nonce "${nonce}" >/dev/null 2>&1 || true
  open_url "${PASSENGER_UDID}" "leafapp://robotaxi/home?qaAutomation=1&qaPassengerAction=${action}&qaNonce=${nonce}"
  sleep "${FLOW_SETTLE_SECONDS}"
}

queue_driver_home_action() {
  local udid="$1"
  local action="$2"
  local nonce="$3"
  "${NODE_BIN}" "${QUEUE_HOME_AUTOMATION_SCRIPT}" \
    --udid "${udid}" \
    --app-id "${APP_ID}" \
    --role driver \
    --action "${action}" \
    --nonce "${nonce}"
}

ensure_driver_online_via_queue() {
  local udid="$1"
  local driver_id="$2"
  local label="$3"
  local queue_nonce_primary="$4"
  local ui_flow_name="$5"
  local queue_nonce_fallback="$6"

  log "bringing ${label} online via queued home automation"
  foreground_app "${udid}" "${FLOW_SETTLE_SECONDS}"
  wait_for_runtime_auth "${udid}" 75 || true

  local driver_online=""
  local driver_online_pending=""
  driver_online="$(read_runtime_field "${udid}" "driverOnline" | tr '[:upper:]' '[:lower:]' | tr -d '\"')"
  driver_online_pending="$(read_runtime_field "${udid}" "driverOnlinePending" | tr '[:upper:]' '[:lower:]' | tr -d '\"')"

  if [[ "${driver_online}" != "true" && "${driver_online_pending}" == "true" ]]; then
    log "${label} restored with stale pending state; clearing offline first"
    run_driver_action "${udid}" set_offline "${label}-clear-stale-pending"
    foreground_app "${udid}" "${FLOW_SETTLE_SECONDS}"
    wait_for_runtime_auth "${udid}" 45 || true
  fi

  run_driver_action "${udid}" set_online "${queue_nonce_primary}"

  if ! wait_for_driver_online "${udid}" 60; then
    local mutation_source=""
    local last_error=""
    mutation_source="$(normalize_runtime_scalar "$(read_runtime_field "${udid}" "driverOnlineMutationSource")")"
    last_error="$(normalize_runtime_scalar "$(read_runtime_field "${udid}" "lastError")")"
    log "${label} did not settle online from queued action; source=${mutation_source:-unknown} error=${last_error:-none}"

    foreground_app "${udid}" "${FLOW_SETTLE_SECONDS}"
    wait_for_runtime_auth "${udid}" 45 || true
    run_driver_action "${udid}" set_online "${queue_nonce_fallback}"

    if ! wait_for_driver_online "${udid}" 75; then
      log "${label} still not online after warmed retry; trying UI fallback once"
      if ! run_flow "${udid}" "${MOBILE_DIR}/.maestro/flows/qa/e2e/lifecycle/01-driver-toggle-online.yaml" "${ui_flow_name}"; then
        log "UI fallback also failed for ${label}"
      fi
      if ! wait_for_driver_online "${udid}" 75; then
        capture_device "${udid}" "${ARTIFACTS_DIR}/${label}-online-timeout.png" || true
        return 1
      fi
    fi
  fi

  wait_for_driver_dispatch_ready "${udid}" "${driver_id}" "${label}-ready" 180
}

normalize_runtime_scalar() {
  local value="${1:-}"
  value="$(printf '%s' "${value}" | tr -d '\"' | xargs 2>/dev/null || true)"
  if [[ -z "${value}" || "${value}" == "null" || "${value}" == "undefined" ]]; then
    printf '\n'
    return 0
  fi
  printf '%s\n' "${value}"
}

cleanup_active_ride_if_needed() {
  log "frontend cleanup of any dangling ride before lifecycle start"

  log "hydrating runtime before cleanup check"
  foreground_app "${PASSENGER_UDID}" 4
  foreground_app "${DRIVER_A_UDID}" 4
  foreground_app "${DRIVER_B_UDID}" 4
  foreground_app "${DRIVER_C_UDID}" 4

  local passenger_booking_id=""
  local passenger_status=""
  local driver_a_booking_id=""
  local driver_a_status=""
  local driver_b_booking_id=""
  local driver_b_status=""
  local driver_c_booking_id=""
  local driver_c_status=""

  passenger_booking_id="$(normalize_runtime_scalar "$(read_runtime_field "${PASSENGER_UDID}" "activeBookingId")")"
  passenger_status="$(normalize_runtime_scalar "$(read_runtime_field "${PASSENGER_UDID}" "bookingStatus")" | tr '[:upper:]' '[:lower:]')"
  driver_a_booking_id="$(normalize_runtime_scalar "$(read_runtime_field "${DRIVER_A_UDID}" "activeBookingId")")"
  driver_a_status="$(normalize_runtime_scalar "$(read_runtime_field "${DRIVER_A_UDID}" "bookingStatus")" | tr '[:upper:]' '[:lower:]')"
  driver_b_booking_id="$(normalize_runtime_scalar "$(read_runtime_field "${DRIVER_B_UDID}" "activeBookingId")")"
  driver_b_status="$(normalize_runtime_scalar "$(read_runtime_field "${DRIVER_B_UDID}" "bookingStatus")" | tr '[:upper:]' '[:lower:]')"
  driver_c_booking_id="$(normalize_runtime_scalar "$(read_runtime_field "${DRIVER_C_UDID}" "activeBookingId")")"
  driver_c_status="$(normalize_runtime_scalar "$(read_runtime_field "${DRIVER_C_UDID}" "bookingStatus")" | tr '[:upper:]' '[:lower:]')"

  if [[ -z "${passenger_booking_id}" && -z "${driver_a_booking_id}" && -z "${driver_b_booking_id}" && -z "${driver_c_booking_id}" ]] && \
    [[ "${passenger_status}" =~ ^(idle|completed)?$ ]] && \
    [[ "${driver_a_status}" =~ ^(idle|completed)?$ ]] && \
    [[ "${driver_b_status}" =~ ^(idle|completed)?$ ]] && \
    [[ "${driver_c_status}" =~ ^(idle|completed)?$ ]]; then
    log "no dangling ride detected after runtime hydration; skipping frontend cleanup"
    return 0
  fi

  run_passenger_action cleanup_active "preflight-cleanup-passenger-1"

  for udid in "${DRIVER_A_UDID}" "${DRIVER_B_UDID}" "${DRIVER_C_UDID}"; do
    run_driver_action "${udid}" accept_offer "preflight-cleanup-accept-${udid}"
    sleep 3
    run_driver_action "${udid}" arrive_pickup "preflight-cleanup-arrive-${udid}"
    sleep 3
    run_driver_action "${udid}" start_trip "preflight-cleanup-start-${udid}"
    sleep 3
    run_driver_action "${udid}" complete_trip "preflight-cleanup-complete-${udid}"
    sleep 3
  done

  run_passenger_action cleanup_active "preflight-cleanup-passenger-2"
  sleep 6
}

cleanup_maestro_processes() {
  pkill -f "maestro-driver-iosUITests-Runner" >/dev/null 2>&1 || true
  pkill -f "xcodebuild test-without-building.*maestro-driver-ios-config" >/dev/null 2>&1 || true
}

install_app() {
  local udid="$1"
  run_with_timeout 10 xcrun simctl terminate "${udid}" "${APP_ID}" >/dev/null 2>&1 || true
  run_with_timeout 15 xcrun simctl uninstall "${udid}" "${APP_ID}" >/dev/null 2>&1 || true
  run_with_timeout 180 xcrun simctl install "${udid}" "${APP_PATH}"
}

disable_dev_menu_onboarding() {
  local udid="$1"
  local data_container=""
  local preferences_dir=""
  local preferences_base=""

  xcrun simctl spawn "${udid}" defaults write "${APP_ID}" EXDevMenuIsOnboardingFinished -bool YES >/dev/null 2>&1 || true
  xcrun simctl spawn "${udid}" defaults write "${APP_ID}" EXDevMenuShowsAtLaunch -bool NO >/dev/null 2>&1 || true

  data_container="$(run_with_timeout 15 xcrun simctl get_app_container "${udid}" "${APP_ID}" data 2>/dev/null || true)"
  if [[ -z "${data_container}" || ! -d "${data_container}" ]]; then
    return 0
  fi

  preferences_dir="${data_container}/Library/Preferences"
  preferences_base="${preferences_dir}/${APP_ID}"
  mkdir -p "${preferences_dir}"
  defaults write "${preferences_base}" EXDevMenuIsOnboardingFinished -bool true >/dev/null 2>&1 || true
  defaults write "${preferences_base}" EXDevMenuShowsAtLaunch -bool false >/dev/null 2>&1 || true
}

terminate_app() {
  local udid="$1"
  run_with_timeout 10 xcrun simctl terminate "${udid}" "${APP_ID}" >/dev/null 2>&1 || true
}

read_runtime_snapshot() {
  local udid="$1"
  "${NODE_BIN}" "${READ_RUNTIME_SCRIPT}" --udid "${udid}" --app-id "${APP_ID}" 2>/dev/null || true
}

read_runtime_field() {
  local udid="$1"
  local field="$2"
  "${NODE_BIN}" "${READ_RUNTIME_SCRIPT}" --udid "${udid}" --app-id "${APP_ID}" --field "${field}" 2>/dev/null || true
}

read_driver_dispatch_snapshot() {
  local driver_id="$1"
  local response_file
  local http_code
  local status_token="${DRIVER_STATUS_DEBUG_TOKEN:-${RUNTIME_ADMIN_TOKEN:-${RESTART_TOKEN:-}}}"
  local curl_args=(
    -sS
    --connect-timeout 3
    --max-time 5
  )

  response_file="$(mktemp)"
  if [[ -n "${status_token}" ]]; then
    curl_args+=(
      -H "x-driver-status-token: ${status_token}"
      -H "x-runtime-token: ${status_token}"
    )
  fi

  http_code="$(curl "${curl_args[@]}" -o "${response_file}" -w '%{http_code}' \
    "${API_BASE_URL}/api/driver-status/${driver_id}" 2>/dev/null || echo '000')"

  if [[ "${http_code}" == "200" ]]; then
    cat "${response_file}"
  else
    printf '{"ready":false,"probe":"driver-status","httpCode":"%s"}\n' "${http_code}"
  fi

  rm -f "${response_file}"
}

seed_auth() {
  local udid="$1"
  local role="$2"
  local profile_key="${3:-}"
  run_with_timeout 10 xcrun simctl terminate "${udid}" "${APP_ID}" >/dev/null 2>&1 || true
  if [[ -n "${profile_key}" ]]; then
    "${NODE_BIN}" "${SEED_AUTH_SCRIPT}" --udid "${udid}" --app-id "${APP_ID}" --role "${role}" --profile-key "${profile_key}"
  else
    "${NODE_BIN}" "${SEED_AUTH_SCRIPT}" --udid "${udid}" --app-id "${APP_ID}" --role "${role}"
  fi
}

seed_home_state() {
  local udid="$1"
  local scenario="$2"
  local uid="$3"
  local current_lat="$4"
  local current_lng="$5"
  local current_address="$6"
  local artifact_dir="${ARTIFACTS_DIR}/_state_seed/${scenario}-${udid}"
  mkdir -p "${artifact_dir}"

  "${NODE_BIN}" "${SEED_STATE_SCRIPT}" \
    --device "${udid}" \
    --scenario "${scenario}" \
    --uid "${uid}" \
    --artifact-dir "${artifact_dir}" \
    --skip-launch \
    --freeze-ms 0 \
    --current-lat "${current_lat}" \
    --current-lng "${current_lng}" \
    --current-address "${current_address}" >/dev/null
}

capture_device() {
  local udid="$1"
  local output="$2"
  xcrun simctl io "${udid}" screenshot "${output}" >/dev/null
}

save_runtime_snapshot() {
  local udid="$1"
  local slug="$2"
  read_runtime_snapshot "${udid}" > "${RUNTIME_STATUS_DIR}/${slug}-${udid}.json" || true
}

capture_stage() {
  local slug="$1"
  local include_driver_b="${2:-true}"
  local include_driver_c="${3:-true}"
  local pids=()
  local failed=0

  capture_device "${PASSENGER_UDID}" "${ARTIFACTS_DIR}/${slug}-passenger.png" &
  pids+=("$!")
  capture_device "${DRIVER_A_UDID}" "${ARTIFACTS_DIR}/${slug}-driver-a.png" &
  pids+=("$!")
  save_runtime_snapshot "${PASSENGER_UDID}" "${slug}-passenger" &
  pids+=("$!")
  save_runtime_snapshot "${DRIVER_A_UDID}" "${slug}-driver-a" &
  pids+=("$!")

  if [[ "${include_driver_b}" == "true" ]]; then
    capture_device "${DRIVER_B_UDID}" "${ARTIFACTS_DIR}/${slug}-driver-b.png" &
    pids+=("$!")
    save_runtime_snapshot "${DRIVER_B_UDID}" "${slug}-driver-b" &
    pids+=("$!")
  fi
  if [[ "${include_driver_c}" == "true" ]]; then
    capture_device "${DRIVER_C_UDID}" "${ARTIFACTS_DIR}/${slug}-driver-c.png" &
    pids+=("$!")
    save_runtime_snapshot "${DRIVER_C_UDID}" "${slug}-driver-c" &
    pids+=("$!")
  fi

  for pid in "${pids[@]}"; do
    wait "${pid}" || failed=1
  done

  return "${failed}"
}

run_flow() {
  local udid="$1"
  local flow="$2"
  local name="$3"
  local attempt
  local max_attempts=2

  for attempt in $(seq 1 "${max_attempts}"); do
    cleanup_maestro_processes
    foreground_app "${udid}" "${FLOW_SETTLE_SECONDS}"
    if maestro test "${flow}" \
      --udid "${udid}" \
      --no-reinstall-driver \
      --debug-output "${ARTIFACTS_DIR}/${name}/debug-output" \
      --test-output-dir "${ARTIFACTS_DIR}/${name}"; then
      return 0
    fi

    if [[ "${attempt}" -lt "${max_attempts}" ]]; then
      log "retrying flow after failure: ${name} (attempt ${attempt}/${max_attempts})"
      cleanup_maestro_processes
      run_with_timeout 10 xcrun simctl terminate "${udid}" "${APP_ID}" >/dev/null 2>&1 || true
      sleep 3
    fi
  done

  return 1
}

run_flow_direct() {
  local udid="$1"
  local flow="$2"
  local name="$3"
  cleanup_maestro_processes
  maestro test "${flow}" \
    --udid "${udid}" \
    --no-reinstall-driver \
    --debug-output "${ARTIFACTS_DIR}/${name}/debug-output" \
    --test-output-dir "${ARTIFACTS_DIR}/${name}"
}

run_flow_direct_nocleanup() {
  local udid="$1"
  local flow="$2"
  local name="$3"
  maestro test "${flow}" \
    --udid "${udid}" \
    --no-reinstall-driver \
    --debug-output "${ARTIFACTS_DIR}/${name}/debug-output" \
    --test-output-dir "${ARTIFACTS_DIR}/${name}"
}

run_parallel_direct_flows() {
  local failed=0
  local pids=()
  local labels=()

  cleanup_maestro_processes

  while (( "$#" >= 3 )); do
    local udid="$1"
    local flow="$2"
    local name="$3"
    shift 3

    run_flow_direct_nocleanup "${udid}" "${flow}" "${name}" &
    pids+=("$!")
    labels+=("${name}")
    sleep 2
  done

  for index in "${!pids[@]}"; do
    if ! wait "${pids[$index]}"; then
      log "parallel flow failed: ${labels[$index]}"
      failed=1
    fi
  done

  return "${failed}"
}

wait_for_status() {
  local udid="$1"
  local expected="$2"
  local timeout_seconds="${3:-180}"
  local started_at
  started_at="$(date +%s)"
  while true; do
    local value
    value="$(read_runtime_field "${udid}" "bookingStatus")"
    if [[ "${value}" == "${expected}" ]]; then
      return 0
    fi
    if (( $(date +%s) - started_at >= timeout_seconds )); then
      log "timed out waiting for ${udid} status=${expected}; current=${value:-unknown}"
      return 1
    fi
    sleep 2
  done
}

wait_for_idle() {
  local udid="$1"
  local timeout_seconds="${2:-180}"
  local started_at
  started_at="$(date +%s)"
  while true; do
    local booking_status
    local active_booking_id
    booking_status="$(read_runtime_field "${udid}" "bookingStatus")"
    active_booking_id="$(read_runtime_field "${udid}" "activeBookingId")"
    if [[ "${booking_status}" == "idle" && "${active_booking_id}" == "null" ]]; then
      return 0
    fi
    if (( $(date +%s) - started_at >= timeout_seconds )); then
      log "timed out waiting for idle on ${udid}; status=${booking_status:-unknown} activeBookingId=${active_booking_id:-unknown}"
      return 1
    fi
    sleep 2
  done
}

wait_for_driver_online() {
  local udid="$1"
  local timeout_seconds="${2:-180}"
  local started_at
  started_at="$(date +%s)"
  while true; do
    local driver_online
    local pending
    driver_online="$(read_runtime_field "${udid}" "driverOnline")"
    pending="$(read_runtime_field "${udid}" "driverOnlinePending")"
    if [[ "${driver_online}" == "true" && "${pending}" != "true" ]]; then
      return 0
    fi
    if (( $(date +%s) - started_at >= timeout_seconds )); then
      log "timed out waiting driver online on ${udid}; online=${driver_online:-unknown} pending=${pending:-unknown}"
      return 1
    fi
    sleep 2
  done
}

wait_for_runtime_auth() {
  local udid="$1"
  local timeout_seconds="${2:-60}"
  local started_at
  started_at="$(date +%s)"
  while true; do
    local profile_uid=""
    local socket_connected=""
    local socket_authenticated=""

    profile_uid="$(normalize_runtime_scalar "$(read_runtime_field "${udid}" "profileUid")")"
    socket_connected="$(normalize_runtime_scalar "$(read_runtime_field "${udid}" "isSocketConnected")" | tr '[:upper:]' '[:lower:]')"
    socket_authenticated="$(normalize_runtime_scalar "$(read_runtime_field "${udid}" "isSocketAuthenticated")" | tr '[:upper:]' '[:lower:]')"

    if [[ -n "${profile_uid}" && "${socket_connected}" == "true" && "${socket_authenticated}" == "true" ]]; then
      return 0
    fi

    if (( $(date +%s) - started_at >= timeout_seconds )); then
      log "timed out waiting runtime auth on ${udid}; uid=${profile_uid:-missing} connected=${socket_connected:-unknown} authenticated=${socket_authenticated:-unknown}"
      return 1
    fi

    sleep 2
  done
}

wait_for_driver_dispatch_ready() {
  local udid="$1"
  local driver_id="$2"
  local label="$3"
  local timeout_seconds="${4:-${DRIVER_DISPATCH_READY_TIMEOUT_SECONDS}}"
  local fallback_grace_seconds=12
  local started_at
  local last_snapshot='{}'
  started_at="$(date +%s)"

  while true; do
    local socket_connected
    local socket_authenticated
    local last_snapshot_path
    socket_connected="$(read_runtime_field "${udid}" "isSocketConnected")"
    socket_authenticated="$(read_runtime_field "${udid}" "isSocketAuthenticated")"
    last_snapshot="$(read_driver_dispatch_snapshot "${driver_id}")"
    last_snapshot_path="${DRIVER_STATUS_DIR}/${label}.json"
    printf '%s\n' "${last_snapshot}" > "${last_snapshot_path}"

    if [[ "${socket_connected}" == "true" && "${socket_authenticated}" == "true" ]] && \
      printf '%s' "${last_snapshot}" | jq -e '
        (.canReceiveRequests == true) and
        (.details.isEligibleInGeo == true) and
        ((.details.dispatchEligible == true) or (.details.dispatchEligible == "true"))
      ' >/dev/null 2>&1; then
      return 0
    fi

    if [[ "${socket_connected}" == "true" && "${socket_authenticated}" == "true" ]] && \
      (( $(date +%s) - started_at >= fallback_grace_seconds )) && \
      printf '%s' "${last_snapshot}" | jq -e '
        (.probe == "driver-status") and
        ((.httpCode == "000") or (.httpCode == "401") or (.httpCode == "403"))
      ' >/dev/null 2>&1; then
      log "driver-status endpoint indisponivel para ${driver_id}; seguindo com fallback local apos ${fallback_grace_seconds}s"
      return 0
    fi

    if (( $(date +%s) - started_at >= timeout_seconds )); then
      log "timed out waiting driver dispatch ready on ${driver_id}; socketConnected=${socket_connected:-unknown} socketAuthenticated=${socket_authenticated:-unknown} snapshot=${last_snapshot}"
      return 1
    fi

    sleep 2
  done
}

distance_to_target_meters() {
  local udid="$1"
  local target_lat="$2"
  local target_lng="$3"
  local snapshot
  snapshot="$(read_runtime_snapshot "${udid}")"
  printf '%s' "${snapshot}" | "${NODE_BIN}" -e '
    const fs = require("fs");
    const raw = fs.readFileSync(0, "utf8");
    const snapshot = raw ? JSON.parse(raw) : {};
    const targetLat = Number(process.argv[1]);
    const targetLng = Number(process.argv[2]);
    const current = snapshot.currentCoordinate || snapshot.driverCoordinate || null;
    const lat = Number(current?.latitude);
    const lng = Number(current?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(targetLat) || !Number.isFinite(targetLng)) {
      process.exit(2);
    }
    const toRad = (value) => (value * Math.PI) / 180;
    const earthRadiusMeters = 6371000;
    const deltaLat = toRad(targetLat - lat);
    const deltaLng = toRad(targetLng - lng);
    const lat1 = toRad(lat);
    const lat2 = toRad(targetLat);
    const a = Math.sin(deltaLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    process.stdout.write(String(Math.round(earthRadiusMeters * c)));
  ' "${target_lat}" "${target_lng}" 2>/dev/null || true
}

wait_until_distance_below() {
  local udid="$1"
  local target_lat="$2"
  local target_lng="$3"
  local threshold_meters="$4"
  local timeout_seconds="${5:-3600}"
  local started_at
  started_at="$(date +%s)"
  while true; do
    local distance
    distance="$(distance_to_target_meters "${udid}" "${target_lat}" "${target_lng}")"
    if [[ -n "${distance}" ]] && (( distance <= threshold_meters )); then
      return 0
    fi
    if (( $(date +%s) - started_at >= timeout_seconds )); then
      log "timed out waiting for ${udid} to reach ${threshold_meters}m; current=${distance:-unknown}m"
      return 1
    fi
    sleep 5
  done
}

fetch_admin_token() {
  API_BASE_URL="${API_BASE_URL}" bash "${TOKEN_HELPER}" "${API_BASE_URL}" 2>/dev/null || true
}

fetch_prometheus() {
  local output="$1"
  local token="$2"
  if [[ -z "${token}" ]]; then
    return 1
  fi
  curl -fsS \
    --connect-timeout 5 \
    --max-time 20 \
    "${API_BASE_URL}/api/metrics/prometheus" \
    -H "Authorization: Bearer ${token}" \
    > "${output}"
}

report_recent_cost_telemetry() {
  local booking_id="$1"
  if [[ -z "${booking_id}" || "${booking_id}" == "null" ]]; then
    return 0
  fi
  (cd "${BACKEND_DIR}" && "${NODE_BIN}" scripts/tests/report-ride-cost-telemetry.cjs "${booking_id}") \
    > "${ARTIFACTS_DIR}/ride-cost-telemetry.json" || true
  "${NODE_BIN}" "${READ_COST_SCRIPT}" --udid "${PASSENGER_UDID}" --app-id "${APP_ID}" --booking-id "${booking_id}" \
    > "${ARTIFACTS_DIR}/sim-ride-cost-telemetry.json" || true
}

log "artifacts: ${ARTIFACTS_DIR}"
append_timeline "run_started" "{\"artifactsDir\":\"${ARTIFACTS_DIR}\"}"

trap restore_local_expo_env EXIT
prepare_local_expo_env

ensure_simulator_window
ensure_metro

for udid in "${PASSENGER_UDID}" "${DRIVER_A_UDID}" "${DRIVER_B_UDID}" "${DRIVER_C_UDID}"; do
  log "preparing device ${udid}"
  append_timeline "device_prepare_started" "{\"udid\":\"${udid}\"}"
  boot_device "${udid}"
  append_timeline "device_boot_ready" "{\"udid\":\"${udid}\"}"
  install_app "${udid}"
  append_timeline "device_app_installed" "{\"udid\":\"${udid}\"}"
  disable_dev_menu_onboarding "${udid}"
  grant_location_permissions "${udid}"
  append_timeline "device_permissions_ready" "{\"udid\":\"${udid}\"}"
done

set_device_location "${PASSENGER_UDID}" "${PICKUP_LAT}" "${PICKUP_LNG}"
set_device_location "${DRIVER_A_UDID}" "${DRIVER_A_LAT}" "${DRIVER_A_LNG}"
set_device_location "${DRIVER_B_UDID}" "${DRIVER_B_LAT}" "${DRIVER_B_LNG}"
set_device_location "${DRIVER_C_UDID}" "${DRIVER_C_LAT}" "${DRIVER_C_LNG}"

append_timeline "devices_booted"

TEST_DRIVER_THREE_PHONE="${TEST_DRIVER_THREE_PHONE:-11888888890}" \
  "${NODE_BIN}" "${BACKEND_DIR}/scripts/tests/ensure-leaf-test-users.cjs" \
  > "${ENSURE_USERS_FILE}"

PASSENGER_UID="$(jq -r '.passenger.uid' "${ENSURE_USERS_FILE}")"
DRIVER_A_UID="$(jq -r '.driver.uid' "${ENSURE_USERS_FILE}")"
DRIVER_B_UID="$(jq -r '.driverTwo.uid' "${ENSURE_USERS_FILE}")"
DRIVER_C_UID="$(jq -r '.driverThree.uid' "${ENSURE_USERS_FILE}")"

append_timeline "users_ensured" "$(jq -c '{passenger: .passenger.uid, driverA: .driver.uid, driverB: .driverTwo.uid, driverC: .driverThree.uid}' "${ENSURE_USERS_FILE}")"

log "seeding auth (prewarm): passenger"
seed_auth "${PASSENGER_UDID}" customer passenger
log "seeding auth (prewarm): driver-a"
seed_auth "${DRIVER_A_UDID}" driver driver
log "seeding auth (prewarm): driver-b"
seed_auth "${DRIVER_B_UDID}" driver driverTwo
log "seeding auth (prewarm): driver-c"
seed_auth "${DRIVER_C_UDID}" driver driverThree

log "seeding daily KYC cache for drivers"
seed_driver_daily_kyc "${DRIVER_A_UID}" "driver-a"
seed_driver_daily_kyc "${DRIVER_B_UID}" "driver-b"
seed_driver_daily_kyc "${DRIVER_C_UID}" "driver-c"

NEEDS_DEV_CLIENT_PREWARM="false"
if [[ "${APP_LAUNCH_MODE}" != "direct" ]]; then
  for prewarm_udid in "${PASSENGER_UDID}" "${DRIVER_A_UDID}" "${DRIVER_B_UDID}" "${DRIVER_C_UDID}"; do
    if [[ ! -f "$(dev_client_marker_path "${prewarm_udid}")" ]]; then
      NEEDS_DEV_CLIENT_PREWARM="true"
      break
    fi
  done
fi

if [[ "${APP_LAUNCH_MODE}" != "direct" && "${NEEDS_DEV_CLIENT_PREWARM}" == "true" ]]; then
  log "prewarming dev client attachments"
  log "foregrounding passenger prewarm"
  foreground_app "${PASSENGER_UDID}" "${FLOW_SETTLE_SECONDS}"
  log "foregrounded passenger prewarm"
  log "foregrounding driver-a prewarm"
  foreground_app "${DRIVER_A_UDID}" "${FLOW_SETTLE_SECONDS}"
  log "foregrounded driver-a prewarm"
  log "foregrounding driver-b prewarm"
  foreground_app "${DRIVER_B_UDID}" "${FLOW_SETTLE_SECONDS}"
  log "foregrounded driver-b prewarm"
  log "foregrounding driver-c prewarm"
  foreground_app "${DRIVER_C_UDID}" "${FLOW_SETTLE_SECONDS}"
  log "foregrounded driver-c prewarm"

  log "re-seeding auth after dev client prewarm"
  log "seeding auth (post-prewarm): passenger"
  seed_auth "${PASSENGER_UDID}" customer passenger
  log "seeding auth (post-prewarm): driver-a"
  seed_auth "${DRIVER_A_UDID}" driver driver
  log "seeding auth (post-prewarm): driver-b"
  seed_auth "${DRIVER_B_UDID}" driver driverTwo
  log "seeding auth (post-prewarm): driver-c"
  seed_auth "${DRIVER_C_UDID}" driver driverThree

  cleanup_active_ride_if_needed

  log "terminating prewarmed apps"
  log "terminating passenger after prewarm"
  terminate_app "${PASSENGER_UDID}"
  log "terminating driver-a after prewarm"
  terminate_app "${DRIVER_A_UDID}"
  log "terminating driver-b after prewarm"
  terminate_app "${DRIVER_B_UDID}"
  log "terminating driver-c after prewarm"
  terminate_app "${DRIVER_C_UDID}"
  log "dev client prewarm complete"
elif [[ "${APP_LAUNCH_MODE}" != "direct" ]]; then
  log "skipping dev client prewarm; shared markers already available"
fi

seed_home_state "${PASSENGER_UDID}" passenger-home "${PASSENGER_UID}" "${PICKUP_LAT}" "${PICKUP_LNG}" "${PICKUP_LABEL}"
seed_home_state "${DRIVER_A_UDID}" driver-home "${DRIVER_A_UID}" "${DRIVER_A_LAT}" "${DRIVER_A_LNG}" "Driver A staging point"
seed_home_state "${DRIVER_B_UDID}" driver-home "${DRIVER_B_UID}" "${DRIVER_B_LAT}" "${DRIVER_B_LNG}" "Driver B staging point"
seed_home_state "${DRIVER_C_UDID}" driver-home "${DRIVER_C_UID}" "${DRIVER_C_LAT}" "${DRIVER_C_LNG}" "Driver C staging point"

set_device_location "${PASSENGER_UDID}" "${PICKUP_LAT}" "${PICKUP_LNG}"
set_device_location "${DRIVER_A_UDID}" "${DRIVER_A_LAT}" "${DRIVER_A_LNG}"
set_device_location "${DRIVER_B_UDID}" "${DRIVER_B_LAT}" "${DRIVER_B_LNG}"
set_device_location "${DRIVER_C_UDID}" "${DRIVER_C_LAT}" "${DRIVER_C_LNG}"

ADMIN_TOKEN="$(fetch_admin_token)"
fetch_prometheus "${PROM_BEFORE_FILE}" "${ADMIN_TOKEN}" || true
append_timeline "prometheus_before_captured"

ensure_driver_online_via_queue "${DRIVER_A_UDID}" "${DRIVER_A_UID}" "driver-a" "01-driver-a-online-primary" "01-driver-a-online-ui-fallback" "01-driver-a-online-fallback"
ensure_driver_online_via_queue "${DRIVER_B_UDID}" "${DRIVER_B_UID}" "driver-b" "01-driver-b-online-primary" "01-driver-b-online-ui-fallback" "01-driver-b-online-fallback"
ensure_driver_online_via_queue "${DRIVER_C_UDID}" "${DRIVER_C_UID}" "driver-c" "01-driver-c-online-primary" "01-driver-c-online-ui-fallback" "01-driver-c-online-fallback"
append_timeline "drivers_online" "{\"driverA\":\"${DRIVER_A_UID}\",\"driverB\":\"${DRIVER_B_UID}\",\"driverC\":\"${DRIVER_C_UID}\"}"

run_flow "${PASSENGER_UDID}" "${MOBILE_DIR}/.maestro/flows/qa/e2e/lifecycle/02-passenger-request-copacabana.yaml" "02-passenger-request"
PASSENGER_BOOKING_ID="$(read_runtime_field "${PASSENGER_UDID}" "activeBookingId")"
append_timeline "ride_requested" "{\"bookingId\":\"${PASSENGER_BOOKING_ID}\"}"
capture_stage "02-request-dispatched"

run_parallel_direct_flows \
  "${DRIVER_A_UDID}" "${MOBILE_DIR}/.maestro/flows/qa/e2e/lifecycle/03-driver-wait-offer.yaml" "03-driver-a-offer" \
  "${DRIVER_B_UDID}" "${MOBILE_DIR}/.maestro/flows/qa/e2e/lifecycle/03-driver-wait-offer.yaml" "03-driver-b-offer" \
  "${DRIVER_C_UDID}" "${MOBILE_DIR}/.maestro/flows/qa/e2e/lifecycle/03-driver-wait-offer.yaml" "03-driver-c-offer"
append_timeline "offers_visible_on_all_drivers"
capture_stage "03-offers-visible"

run_driver_action "${DRIVER_A_UDID}" accept_offer "lifecycle-driver-accept-offer" true
wait_for_status "${PASSENGER_UDID}" accepted 180
wait_for_status "${DRIVER_A_UDID}" accepted 180
append_timeline "driver_a_accepted" "{\"bookingId\":\"${PASSENGER_BOOKING_ID}\"}"
capture_stage "04-driver-accepted"

sleep "${APPROACH_EVIDENCE_WAIT_SECONDS}"
capture_stage "05-driver-enroute-evidence"
append_timeline "driver_enroute_evidence_captured"

run_driver_action "${DRIVER_A_UDID}" arrive_pickup "lifecycle-driver-arrive-pickup" true
wait_for_status "${PASSENGER_UDID}" arrived 180
wait_for_status "${DRIVER_A_UDID}" arrived 180
append_timeline "driver_arrived_pickup"
capture_stage "06-driver-arrived"

run_driver_action "${DRIVER_A_UDID}" start_trip "lifecycle-driver-start-trip" true
wait_for_status "${PASSENGER_UDID}" started 180
wait_for_status "${DRIVER_A_UDID}" started 180
append_timeline "trip_started"
capture_stage "07-trip-started"

sleep 30
capture_stage "08-trip-in-progress" false false
append_timeline "trip_in_progress_evidence_captured"

run_driver_action "${DRIVER_A_UDID}" complete_trip "lifecycle-driver-complete-trip" true
wait_for_status "${PASSENGER_UDID}" completed 240
wait_for_status "${DRIVER_A_UDID}" completed 240
append_timeline "trip_completed"
capture_stage "09-trip-completed" false false

run_flow "${PASSENGER_UDID}" "${MOBILE_DIR}/.maestro/flows/qa/e2e/lifecycle/07-passenger-rate-trip.yaml" "08-passenger-rate"
append_timeline "passenger_rating_submitted"
capture_stage "10-passenger-rated" false false

run_flow "${DRIVER_A_UDID}" "${MOBILE_DIR}/.maestro/flows/qa/e2e/lifecycle/08-driver-rate-passenger.yaml" "09-driver-rate-passenger"
append_timeline "driver_rating_submitted"
capture_stage "11-driver-rated" false false

run_flow "${PASSENGER_UDID}" "${MOBILE_DIR}/.maestro/flows/qa/e2e/lifecycle/10-passenger-receipt-back-to-map.yaml" "10-passenger-back-to-map"
run_flow "${DRIVER_A_UDID}" "${MOBILE_DIR}/.maestro/flows/qa/e2e/lifecycle/09-driver-receipt-back-to-map.yaml" "11-driver-back-to-map"
wait_for_idle "${PASSENGER_UDID}" 180
append_timeline "apps_back_to_map"
capture_stage "12-reset-state" false false

run_flow "${DRIVER_A_UDID}" "${MOBILE_DIR}/.maestro/flows/qa/e2e/lifecycle/11-driver-open-earnings.yaml" "12-driver-open-earnings"
append_timeline "driver_earnings_opened"
capture_stage "13-driver-earnings" false false

PASSENGER_RUNTIME="$(read_runtime_snapshot "${PASSENGER_UDID}")"
DRIVER_RUNTIME="$(read_runtime_snapshot "${DRIVER_A_UDID}")"

printf '%s\n' "${PASSENGER_RUNTIME}" > "${ARTIFACTS_DIR}/passenger-runtime-final.json"
printf '%s\n' "${DRIVER_RUNTIME}" > "${ARTIFACTS_DIR}/driver-runtime-final.json"

RIDE_RECEIPT_ID="$(printf '%s' "${PASSENGER_RUNTIME}" | jq -r '.lastReceipt.id // .activeBookingId // empty' 2>/dev/null || true)"
report_recent_cost_telemetry "${RIDE_RECEIPT_ID}"
fetch_prometheus "${PROM_AFTER_FILE}" "${ADMIN_TOKEN}" || true
append_timeline "prometheus_after_captured"

cat > "${ARTIFACTS_DIR}/run-summary.json" <<EOF
{
  "artifactsDir": "${ARTIFACTS_DIR}",
  "apiBaseUrl": "${API_BASE_URL}",
  "wsUrl": "${WS_URL}",
  "pickup": {
    "address": "${PICKUP_LABEL}",
    "latitude": ${PICKUP_LAT},
    "longitude": ${PICKUP_LNG}
  },
  "destination": {
    "address": "${DESTINATION_LABEL}",
    "latitude": ${DEST_LAT},
    "longitude": ${DEST_LNG}
  },
  "playbackSpeedMps": ${PLAYBACK_SPEED_MPS},
  "playbackQaMultiplier": ${PLAYBACK_QA_MULTIPLIER},
  "dispatchConfig": {
    "driversPerWave": ${MATCH_DRIVERS_PER_WAVE},
    "minUniqueDriversBeforePause": ${MATCH_RESPONSE_PAUSE_MIN_UNIQUE_DRIVERS},
    "driverResponseTimeoutSeconds": ${DISPATCH_DRIVER_RESPONSE_TIMEOUT_SECONDS},
    "offerReservationTtlSeconds": ${OFFER_RESERVATION_TTL_SECONDS},
    "driverLivenessGraceMs": ${DISPATCH_DRIVER_LIVENESS_GRACE_MS},
    "driverDisconnectGraceMs": ${DRIVER_DISCONNECT_GRACE_MS}
  },
  "bookingId": "${PASSENGER_BOOKING_ID}",
  "receiptId": "${RIDE_RECEIPT_ID}",
  "passengerUid": "${PASSENGER_UID}",
  "driverAUid": "${DRIVER_A_UID}",
  "driverBUid": "${DRIVER_B_UID}",
  "driverCUid": "${DRIVER_C_UID}"
}
EOF

append_timeline "run_finished" "{\"bookingId\":\"${PASSENGER_BOOKING_ID}\",\"receiptId\":\"${RIDE_RECEIPT_ID}\"}"
log "done"
log "artifacts: ${ARTIFACTS_DIR}"
