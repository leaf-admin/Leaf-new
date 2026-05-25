#!/usr/bin/env bash
set -euo pipefail

MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ROOT_DIR="$(cd "${MOBILE_DIR}/.." && pwd)"
BACKEND_DIR="${ROOT_DIR}/leaf-websocket-backend"

NODE_BIN_DIR="${NODE_BIN_DIR:-}"
if [[ -z "${NODE_BIN_DIR}" && -d "${HOME}/.nvm/versions/node" ]]; then
  NODE_BIN_DIR="${HOME}/.nvm/versions/node/$(ls -1 "${HOME}/.nvm/versions/node" | sort -V | tail -n 1)/bin"
fi
if [[ -n "${NODE_BIN_DIR}" && -d "${NODE_BIN_DIR}" ]]; then
  export PATH="${NODE_BIN_DIR}:${PATH}"
fi
if [[ -d "${HOME}/.maestro/bin" ]]; then
  export PATH="${HOME}/.maestro/bin:${PATH}"
fi

DRIVER_ONE_UDID="${DRIVER_ONE_UDID:-195D2C57-87DC-4953-ABF1-4FD351ADBBEF}"
DRIVER_TWO_UDID="${DRIVER_TWO_UDID:-2E44BC8E-9AA8-43BE-BD5E-D0B5A73E543C}"
APP_ID="${APP_ID:-br.com.leaf.ride}"
APP_PATH="${APP_PATH:-}"
DEBUG_APP_PATH="${MOBILE_DIR}/ios/build/Build/Products/Debug-iphonesimulator/Leaf.app"
RELEASE_APP_PATH="${MOBILE_DIR}/ios/build/Build/Products/Release-iphonesimulator/Leaf.app"

API_BASE_URL="${API_BASE_URL:-https://api.leaf.app.br}"
WS_URL="${WS_URL:-https://socket.leaf.app.br}"
DO_HOST="${DO_HOST:-147.182.204.181}"
DO_KEY="${DO_KEY:-${ROOT_DIR}/digitaloceankey}"

PASSENGER_PHONE="${PASSENGER_PHONE:-21102938475}"
PASSENGER_TWO_PHONE="${PASSENGER_TWO_PHONE:-21102938476}"
PASSENGER_THREE_PHONE="${PASSENGER_THREE_PHONE:-21102938477}"
PASSENGER_FOUR_PHONE="${PASSENGER_FOUR_PHONE:-21102938478}"
DRIVER_ONE_PHONE="${DRIVER_ONE_PHONE:-21123456789}"
DRIVER_TWO_PHONE="${DRIVER_TWO_PHONE:-21123456790}"

STABILIZATION_SECONDS="${STABILIZATION_SECONDS:-8}"
FLOW_SETTLE_SECONDS="${FLOW_SETTLE_SECONDS:-5}"
SCENARIOS="${SCENARIOS:-1,2,3,4,5,6}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
ARTIFACTS_DIR="${ARTIFACTS_DIR:-${ROOT_DIR}/reports/validation-runs/${TIMESTAMP}_dual-driver-concurrency-ios}"
ENSURE_USERS_CACHE="${MOBILE_DIR}/test-results/qa-preflight/ensure-users.json"

SEED_AUTH_SCRIPT="${ROOT_DIR}/scripts/validation/lib/seed-sim-auth.cjs"
RESET_SIM_RUNTIME_SCRIPT="${ROOT_DIR}/scripts/validation/lib/reset-sim-prototype-runtime.cjs"
QUEUE_HOME_AUTOMATION_SCRIPT="${ROOT_DIR}/scripts/validation/lib/queue-sim-home-automation.cjs"
READ_SIM_RUNTIME_SCRIPT="${ROOT_DIR}/scripts/validation/lib/read-sim-runtime-state.cjs"
GUARDED_IOS_LAUNCH_SCRIPT="${ROOT_DIR}/scripts/validation/lib/guarded-ios-launch.sh"
ACCEPT_OPEN_PROMPT_FLOW="${MOBILE_DIR}/.maestro/flows/qa/_accept-open-prompt.yaml"

PASSENGER_UID=""
PASSENGER_TWO_UID=""
PASSENGER_THREE_UID=""
PASSENGER_FOUR_UID=""
DRIVER_ONE_UID=""
DRIVER_TWO_UID=""
DRIVER_ONE_NAME=""
DRIVER_TWO_NAME=""

mkdir -p "${ARTIFACTS_DIR}"

log() {
  printf "[dual-driver] %s\n" "$1"
}

scenario_enabled() {
  local needle="$1"
  [[ ",${SCENARIOS}," == *",${needle},"* ]]
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log "missing command: $1"
    exit 1
  fi
}

for cmd in node xcrun maestro bash ssh; do
  require_cmd "$cmd"
done

resolve_latest_sim_app_path() {
  if [[ -n "${APP_PATH}" ]]; then
    printf '%s\n' "${APP_PATH}"
    return
  fi

  local newest_path=""
  local newest_mtime="0"
  local candidate=""
  local candidate_mtime=""

  for candidate in "${DEBUG_APP_PATH}" "${RELEASE_APP_PATH}"; do
    if [[ ! -d "${candidate}" ]]; then
      continue
    fi
    candidate_mtime="$(stat -f '%m' "${candidate}" 2>/dev/null || echo 0)"
    if [[ -z "${newest_path}" || "${candidate_mtime}" -gt "${newest_mtime}" ]]; then
      newest_path="${candidate}"
      newest_mtime="${candidate_mtime}"
    fi
  done

  printf '%s\n' "${newest_path}"
}

APP_PATH="$(resolve_latest_sim_app_path)"
USE_INSTALLED_APP_ONLY="false"
if [[ ! -d "${APP_PATH}" ]]; then
  if xcrun simctl get_app_container "${DRIVER_ONE_UDID}" "${APP_ID}" data >/dev/null 2>&1 && \
    xcrun simctl get_app_container "${DRIVER_TWO_UDID}" "${APP_ID}" data >/dev/null 2>&1; then
    USE_INSTALLED_APP_ONLY="true"
    APP_PATH=""
    log "no fresh simulator build found; reusing the app already installed on both devices"
  else
    log "app not found in simulator build products and not installed on both devices"
    exit 1
  fi
fi

USE_DEV_CLIENT_DEEPLINK="${USE_DEV_CLIENT_DEEPLINK:-false}"
if [[ "${APP_PATH}" == *"/Debug-iphonesimulator/"* ]]; then
  USE_DEV_CLIENT_DEEPLINK="true"
fi

encode_dev_client_url() {
  node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$1"
}

METRO_HOST="${METRO_HOST:-127.0.0.1}"
METRO_PORT="${METRO_PORT:-8081}"
DEV_CLIENT_BUNDLE_URL="http://${METRO_HOST}:${METRO_PORT}"
DEV_CLIENT_DEEPLINK="exp+leafapp-reactnative://expo-development-client/?url=$(encode_dev_client_url "${DEV_CLIENT_BUNDLE_URL}")"

dev_client_marker_path() {
  local udid="$1"
  printf '%s\n' "${ARTIFACTS_DIR}/_dev_client_attached_${udid}"
}

metro_is_listening() {
  lsof -nP -iTCP:"${METRO_PORT}" -sTCP:LISTEN >/dev/null 2>&1
}

passenger_uid_csv() {
  local values=()
  local passenger_uid=""
  for passenger_uid in "${PASSENGER_UID}" "${PASSENGER_TWO_UID}" "${PASSENGER_THREE_UID}" "${PASSENGER_FOUR_UID}"; do
    if [[ -n "${passenger_uid}" ]]; then
      values+=("${passenger_uid}")
    fi
  done
  (
    IFS=,
    printf '%s' "${values[*]}"
  )
}

run_with_timeout() {
  local timeout_seconds="$1"
  shift
  "$@" &
  local cmd_pid=$!
  local started_at
  started_at="$(date +%s)"

  while kill -0 "${cmd_pid}" >/dev/null 2>&1; do
    if (( $(date +%s) - started_at >= timeout_seconds )); then
      kill -TERM "${cmd_pid}" >/dev/null 2>&1 || true
      sleep 1
      kill -KILL "${cmd_pid}" >/dev/null 2>&1 || true
      wait "${cmd_pid}" >/dev/null 2>&1 || true
      return 124
    fi
    sleep 1
  done

  wait "${cmd_pid}"
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
    if (( $(date +%s) - started_at >= 45 )); then
      log "device ${udid} did not reach Booted state in time"
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

suppress_dev_client_onboarding() {
  local udid="$1"
  xcrun simctl spawn "${udid}" defaults write "${APP_ID}" EXDevMenuIsOnboardingFinished -bool YES >/dev/null 2>&1 || true
  xcrun simctl spawn "${udid}" defaults write "${APP_ID}" EXDevMenuShowsAtLaunch -bool NO >/dev/null 2>&1 || true
}

foreground_app() {
  local udid="$1"
  local settle_seconds="${2:-${FLOW_SETTLE_SECONDS}}"
  local launch_artifacts_dir="${ARTIFACTS_DIR}/_launch_watch/${udid}"
  local dev_client_marker
  mkdir -p "${launch_artifacts_dir}"

  if [[ "${USE_DEV_CLIENT_DEEPLINK}" == "true" ]]; then
    if ! metro_is_listening; then
      log "metro is not listening on port ${METRO_PORT}; start Expo dev server before running the dual-driver concurrency flow"
      return 1
    fi

    run_with_timeout $((settle_seconds + 10)) \
      xcrun simctl launch "${udid}" "${APP_ID}" >/dev/null 2>&1 || true

    dev_client_marker="$(dev_client_marker_path "${udid}")"
    if [[ ! -f "${dev_client_marker}" ]]; then
      run_with_timeout 10 xcrun simctl openurl "${udid}" "${DEV_CLIENT_DEEPLINK}" >/dev/null || true
      run_with_timeout 20 maestro test "${ACCEPT_OPEN_PROMPT_FLOW}" \
        --udid "${udid}" \
        --no-reinstall-driver \
        --test-output-dir "${ARTIFACTS_DIR}/dev-client-open-${udid}" >/dev/null || true
      touch "${dev_client_marker}"
    fi

    sleep "${settle_seconds}"
    return 0
  fi

  run_with_timeout $((settle_seconds + 15)) \
    bash "${GUARDED_IOS_LAUNCH_SCRIPT}" "${udid}" "${APP_ID}" "${settle_seconds}" "${launch_artifacts_dir}" >/dev/null
}

reset_runtime_state() {
  local udid="$1"
  local role="$2"
  node "${RESET_SIM_RUNTIME_SCRIPT}" \
    --udid "${udid}" \
    --app-id "${APP_ID}" \
    --role "${role}" >/dev/null
}

reinstall_dual_driver_apps() {
  for udid in "${DRIVER_ONE_UDID}" "${DRIVER_TWO_UDID}"; do
    rm -f "$(dev_client_marker_path "${udid}")"
    run_with_timeout 10 xcrun simctl terminate "${udid}" "${APP_ID}" >/dev/null 2>&1 || true
    if [[ "${USE_INSTALLED_APP_ONLY}" != "true" ]]; then
      run_with_timeout 15 xcrun simctl uninstall "${udid}" "${APP_ID}" >/dev/null 2>&1 || true
      run_with_timeout 90 xcrun simctl install "${udid}" "${APP_PATH}"
    fi
    suppress_dev_client_onboarding "${udid}"
    grant_location_permissions "${udid}"
  done
}

ensure_test_users() {
  local ensure_out="${ARTIFACTS_DIR}/ensure-users.json"
  log "ensuring canonical QA users for passenger + 2 drivers"
  mkdir -p "$(dirname "${ENSURE_USERS_CACHE}")"
  (
    cd "${BACKEND_DIR}" && \
      TEST_PASSENGER_PHONE="${PASSENGER_PHONE}" \
      TEST_PASSENGER_TWO_PHONE="${PASSENGER_TWO_PHONE}" \
      TEST_PASSENGER_THREE_PHONE="${PASSENGER_THREE_PHONE}" \
      TEST_PASSENGER_FOUR_PHONE="${PASSENGER_FOUR_PHONE}" \
      TEST_DRIVER_PHONE="${DRIVER_ONE_PHONE}" \
      TEST_DRIVER_TWO_PHONE="${DRIVER_TWO_PHONE}" \
      node scripts/tests/ensure-leaf-test-users.cjs
  ) > "${ensure_out}"
  cp "${ensure_out}" "${ENSURE_USERS_CACHE}"

  PASSENGER_UID="$(node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(String(data.passenger.uid||''));" "${ensure_out}")"
  PASSENGER_TWO_UID="$(node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(String(data.passengerTwo.uid||''));" "${ensure_out}")"
  PASSENGER_THREE_UID="$(node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(String(data.passengerThree.uid||''));" "${ensure_out}")"
  PASSENGER_FOUR_UID="$(node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(String(data.passengerFour.uid||''));" "${ensure_out}")"
  DRIVER_ONE_UID="$(node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(String(data.driver.uid||''));" "${ensure_out}")"
  DRIVER_TWO_UID="$(node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(String(data.driverTwo.uid||''));" "${ensure_out}")"
  DRIVER_ONE_NAME="$(node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(String(data.driver.name||'Leaf Motorista Teste'));" "${ensure_out}")"
  DRIVER_TWO_NAME="$(node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(String(data.driverTwo.name||'Leaf Motorista Teste 2'));" "${ensure_out}")"

  if [[ -z "${PASSENGER_UID}" || -z "${PASSENGER_TWO_UID}" || -z "${PASSENGER_THREE_UID}" || -z "${PASSENGER_FOUR_UID}" || -z "${DRIVER_ONE_UID}" || -z "${DRIVER_TWO_UID}" ]]; then
    log "failed to ensure canonical QA users"
    exit 1
  fi
}

seed_driver_auths() {
  log "seeding auth payloads for both driver simulators"
  node "${SEED_AUTH_SCRIPT}" --udid "${DRIVER_ONE_UDID}" --app-id "${APP_ID}" --role driver --profile-key driver
  node "${SEED_AUTH_SCRIPT}" --udid "${DRIVER_TWO_UDID}" --app-id "${APP_ID}" --role driver --profile-key driverTwo
}

cleanup_remote_runtime_state() {
  if [[ ! -f "${DO_KEY}" ]]; then
    log "warning: DO key not found at ${DO_KEY}; skipping remote runtime cleanup"
    return 0
  fi

  local cleanup_out="${ARTIFACTS_DIR}/remote-cleanup-$(date +%s).json"
  local passenger_uid_list
  passenger_uid_list="$(passenger_uid_csv)"
  if ssh -i "${DO_KEY}" -o StrictHostKeyChecking=no -o ConnectTimeout=8 "root@${DO_HOST}" \
    "docker exec -i -e TEST_PASSENGER_UIDS='${passenger_uid_list}' -e TEST_DRIVER_ONE_UID='${DRIVER_ONE_UID}' -e TEST_DRIVER_TWO_UID='${DRIVER_TWO_UID}' leaf-websocket node -" > "${cleanup_out}" 2>&1 <<'NODE'
const Redis = require('ioredis');

const passengerUids = String(process.env.TEST_PASSENGER_UIDS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const driverUids = [process.env.TEST_DRIVER_ONE_UID, process.env.TEST_DRIVER_TWO_UID].filter(Boolean);
const redis = new Redis(process.env.REDIS_URL);

async function main() {
  if (passengerUids.length === 0 || driverUids.length === 0) {
    throw new Error('missing_test_uids');
  }

  await redis.ping();

  const relatedBookingIds = new Set();
  const keys = new Set();

  for (const passengerUid of passengerUids) {
    const activeBooking = await redis.get(`customer_active_booking:${passengerUid}`);
    keys.add(`customer_active_booking:${passengerUid}`);
    if (activeBooking) {
      relatedBookingIds.add(activeBooking);
    }
  }

  for (const driverUid of driverUids) {
    keys.add(`driver_soft_ban:${driverUid}`);
    keys.add(`driver_lock:${driverUid}`);
    keys.add(`driver_active_notification:${driverUid}`);
    keys.add(`active_trip_by_driver:${driverUid}`);
    keys.add(`active_trip_customer_by_driver:${driverUid}`);
    const cooldownKeys = await redis.keys(`ride_reoffer_cooldown:*:${driverUid}`);
    cooldownKeys.forEach((key) => keys.add(key));
  }

  for (const driverUid of driverUids) {
    const activeNotification = await redis.get(`driver_active_notification:${driverUid}`);
    const activeTrip = await redis.get(`active_trip_by_driver:${driverUid}`);
    if (activeNotification) relatedBookingIds.add(activeNotification);
    if (activeTrip) relatedBookingIds.add(activeTrip);
  }

  for (const bookingId of relatedBookingIds) {
    keys.add(`ride_excluded_drivers:${bookingId}`);
    keys.add(`ride_notifications:${bookingId}`);
    keys.add(`ride_rejection_count:${bookingId}`);
    for (const driverUid of driverUids) {
      keys.add(`ride_reoffer_cooldown:${bookingId}:${driverUid}`);
    }
  }

  const deletedKeys = Array.from(keys);
  const deletedCount = deletedKeys.length ? await redis.del(...deletedKeys) : 0;

  for (const driverUid of driverUids) {
    await redis.hdel(`driver:${driverUid}`, 'activeTripId', 'activeTripUpdatedAt');
  }

  console.log(JSON.stringify({
    ok: true,
    deletedCount,
    deletedKeys,
    relatedBookingIds: Array.from(relatedBookingIds),
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
    log "remote runtime cleanup ok"
  else
    log "warning: remote runtime cleanup failed; see ${cleanup_out}"
  fi
}

read_runtime_json() {
  node "${READ_SIM_RUNTIME_SCRIPT}" --udid "$1" --app-id "${APP_ID}" 2>/dev/null || true
}

read_async_storage_value() {
  local udid="$1"
  local storage_key="$2"
  UDID="${udid}" APP_ID="${APP_ID}" STORAGE_KEY="${storage_key}" node - <<'NODE'
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const udid = String(process.env.UDID || '').trim();
const appId = String(process.env.APP_ID || '').trim();
const storageKey = String(process.env.STORAGE_KEY || '').trim();

if (!udid || !appId || !storageKey) {
  process.exit(1);
}

let containerPath = '';
try {
  containerPath = execFileSync(
    'xcrun',
    ['simctl', 'get_app_container', udid, appId, 'data'],
    { encoding: 'utf8' },
  ).trim();
} catch (_error) {
  process.exit(2);
}

const storageDir = path.join(
  containerPath,
  'Library',
  'Application Support',
  appId,
  'RCTAsyncLocalStorage_V1',
);

if (!fs.existsSync(storageDir)) {
  process.exit(3);
}

const manifestPath = path.join(storageDir, 'manifest.json');
if (fs.existsSync(manifestPath)) {
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (Object.prototype.hasOwnProperty.call(manifest, storageKey) && manifest[storageKey] != null) {
      process.stdout.write(String(manifest[storageKey]));
      process.exit(0);
    }
  } catch (_error) {}
}

const hashedPath = path.join(
  storageDir,
  crypto.createHash('md5').update(storageKey).digest('hex'),
);

if (!fs.existsSync(hashedPath)) {
  process.exit(4);
}

process.stdout.write(fs.readFileSync(hashedPath, 'utf8'));
NODE
}

runtime_debug_probe_count() {
  local udid="$1"
  local expected_step="$2"
  local message_fragment="${3:-}"
  local history_json
  history_json="$(read_async_storage_value "${udid}" "@prototype_runtime_debug_history" 2>/dev/null || true)"
  if [[ -z "${history_json}" ]]; then
    printf '0'
    return 0
  fi

  HISTORY_JSON="${history_json}" EXPECTED_STEP="${expected_step}" MESSAGE_FRAGMENT="${message_fragment}" node - <<'NODE'
const history = JSON.parse(process.env.HISTORY_JSON || '[]');
const expectedStep = String(process.env.EXPECTED_STEP || '').trim();
const messageFragment = String(process.env.MESSAGE_FRAGMENT || '').trim().toLowerCase();

const count = (Array.isArray(history) ? history : []).filter((entry) => {
  if (String(entry?.step || '').trim() !== expectedStep) {
    return false;
  }
  if (!messageFragment) {
    return true;
  }
  const haystack = JSON.stringify(entry?.data || {}).toLowerCase();
  return haystack.includes(messageFragment);
}).length;

process.stdout.write(String(count));
NODE
}

wait_for_runtime_debug_probe_count() {
  local udid="$1"
  local expected_step="$2"
  local minimum_count="$3"
  local message_fragment="${4:-}"
  local timeout_seconds="${5:-30}"
  local started_at
  started_at="$(date +%s)"

  while true; do
    local current_count
    current_count="$(runtime_debug_probe_count "${udid}" "${expected_step}" "${message_fragment}")"
    if [[ "${current_count}" =~ ^[0-9]+$ ]] && (( current_count >= minimum_count )); then
      return 0
    fi
    if (( $(date +%s) - started_at >= timeout_seconds )); then
      log "debug probe ${expected_step} did not reach count ${minimum_count} on ${udid} in ${timeout_seconds}s"
      return 1
    fi
    sleep 1
  done
}

runtime_active_booking_id() {
  local snapshot
  snapshot="$(read_runtime_json "$1")"
  if [[ -z "${snapshot}" ]]; then
    return 0
  fi
  SNAPSHOT_JSON="${snapshot}" node -e "const s=JSON.parse(process.env.SNAPSHOT_JSON||'{}'); const value=s.activeBookingId; process.stdout.write(value == null ? '' : String(value));"
}

runtime_booking_status() {
  local snapshot
  snapshot="$(read_runtime_json "$1")"
  if [[ -z "${snapshot}" ]]; then
    return 0
  fi
  SNAPSHOT_JSON="${snapshot}" node -e "const s=JSON.parse(process.env.SNAPSHOT_JSON||'{}'); process.stdout.write(String(s.bookingStatus||''));"
}

runtime_driver_online() {
  local snapshot
  snapshot="$(read_runtime_json "$1")"
  if [[ -z "${snapshot}" ]]; then
    return 0
  fi
  SNAPSHOT_JSON="${snapshot}" node -e "const s=JSON.parse(process.env.SNAPSHOT_JSON||'{}'); process.stdout.write(s.driverOnline===true ? 'true' : 'false');"
}

runtime_driver_online_pending() {
  local snapshot
  snapshot="$(read_runtime_json "$1")"
  if [[ -z "${snapshot}" ]]; then
    return 0
  fi
  SNAPSHOT_JSON="${snapshot}" node -e "const s=JSON.parse(process.env.SNAPSHOT_JSON||'{}'); process.stdout.write(s.driverOnlinePending===true ? 'true' : 'false');"
}

runtime_socket_authenticated() {
  local snapshot
  snapshot="$(read_runtime_json "$1")"
  if [[ -z "${snapshot}" ]]; then
    return 0
  fi
  SNAPSHOT_JSON="${snapshot}" node -e "const s=JSON.parse(process.env.SNAPSHOT_JSON||'{}'); process.stdout.write(s.isSocketAuthenticated===true ? 'true' : 'false');"
}

runtime_has_offer_booking() {
  local udid="$1"
  local booking_id="$2"
  local snapshot
  snapshot="$(read_runtime_json "${udid}")"
  if [[ -z "${snapshot}" ]]; then
    return 1
  fi
  SNAPSHOT_JSON="${snapshot}" BOOKING_ID="${booking_id}" node -e "const s=JSON.parse(process.env.SNAPSHOT_JSON||'{}'); const id=String(process.env.BOOKING_ID||''); const offers=Array.isArray(s.driverOffers)?s.driverOffers:[]; const ok=offers.some((offer)=>String(offer.bookingId||offer.id||'')===id); process.exit(ok ? 0 : 1);"
}

runtime_transient_type() {
  local snapshot
  snapshot="$(read_runtime_json "$1")"
  if [[ -z "${snapshot}" ]]; then
    return 0
  fi
  SNAPSHOT_JSON="${snapshot}" node -e "const s=JSON.parse(process.env.SNAPSHOT_JSON||'{}'); process.stdout.write(String(s.driverTransientCard?.type||''));"
}

runtime_last_transient_type() {
  local snapshot
  snapshot="$(read_runtime_json "$1")"
  if [[ -z "${snapshot}" ]]; then
    return 0
  fi
  SNAPSHOT_JSON="${snapshot}" node -e "const s=JSON.parse(process.env.SNAPSHOT_JSON||'{}'); process.stdout.write(String(s.driverLastTransientCard?.type||''));"
}

runtime_last_transient_id() {
  local snapshot
  snapshot="$(read_runtime_json "$1")"
  if [[ -z "${snapshot}" ]]; then
    return 0
  fi
  SNAPSHOT_JSON="${snapshot}" node -e "const s=JSON.parse(process.env.SNAPSHOT_JSON||'{}'); process.stdout.write(String(s.driverLastTransientCard?.id||''));"
}

runtime_has_visible_transient() {
  local udid="$1"
  local expected_type="${2:-}"
  local snapshot
  snapshot="$(read_runtime_json "${udid}")"
  if [[ -z "${snapshot}" ]]; then
    return 1
  fi
  SNAPSHOT_JSON="${snapshot}" EXPECTED_TYPE="${expected_type}" node -e "const s=JSON.parse(process.env.SNAPSHOT_JSON||'{}'); const card=s.driverTransientCard||{}; const id=String(card.id||'').trim(); const type=String(card.type||'').trim(); const expected=String(process.env.EXPECTED_TYPE||'').trim(); const visibleUntilMs=new Date(card.visibleUntil||'').getTime(); const visible=id && (!Number.isFinite(visibleUntilMs) || visibleUntilMs > Date.now()); const matches=!expected || type===expected; process.exit(visible && matches ? 0 : 1);"
}

runtime_has_recorded_transient() {
  local udid="$1"
  local expected_type="${2:-}"
  local snapshot
  snapshot="$(read_runtime_json "${udid}")"
  if [[ -z "${snapshot}" ]]; then
    return 1
  fi
  SNAPSHOT_JSON="${snapshot}" EXPECTED_TYPE="${expected_type}" node -e "const s=JSON.parse(process.env.SNAPSHOT_JSON||'{}'); const expected=String(process.env.EXPECTED_TYPE||'').trim(); const visible=s.driverTransientCard||{}; const last=s.driverLastTransientCard||{}; const types=[String(visible.type||'').trim(),String(last.type||'').trim()].filter(Boolean); const ok=!expected ? types.length>0 : types.includes(expected); process.exit(ok ? 0 : 1);"
}

wait_for_online() {
  local udid="$1"
  local timeout_seconds="${2:-60}"
  local started_at
  started_at="$(date +%s)"

  while true; do
    if [[ "$(runtime_driver_online "${udid}")" == "true" && "$(runtime_driver_online_pending "${udid}")" != "true" ]]; then
      return 0
    fi
    if (( $(date +%s) - started_at >= timeout_seconds )); then
      log "driver ${udid} did not stabilize online in ${timeout_seconds}s"
      return 1
    fi
    sleep 2
  done
}

wait_for_offer_visible() {
  local udid="$1"
  local booking_id="$2"
  local timeout_seconds="${3:-60}"
  local started_at
  started_at="$(date +%s)"

  while true; do
    if runtime_has_offer_booking "${udid}" "${booking_id}" && [[ "$(runtime_active_booking_id "${udid}")" == "${booking_id}" ]]; then
      return 0
    fi
    if (( $(date +%s) - started_at >= timeout_seconds )); then
      log "offer ${booking_id} did not appear on ${udid} in ${timeout_seconds}s"
      return 1
    fi
    sleep 2
  done
}

wait_for_offer_absent() {
  local udid="$1"
  local booking_id="$2"
  local timeout_seconds="${3:-60}"
  local started_at
  started_at="$(date +%s)"

  while true; do
    if ! runtime_has_offer_booking "${udid}" "${booking_id}" && [[ "$(runtime_active_booking_id "${udid}")" != "${booking_id}" ]]; then
      return 0
    fi
    if (( $(date +%s) - started_at >= timeout_seconds )); then
      log "offer ${booking_id} did not disappear from ${udid} in ${timeout_seconds}s"
      return 1
    fi
    sleep 2
  done
}

wait_for_booking_status() {
  local udid="$1"
  local booking_id="$2"
  local expected_status="$3"
  local timeout_seconds="${4:-60}"
  local started_at
  started_at="$(date +%s)"

  while true; do
    if [[ "$(runtime_active_booking_id "${udid}")" == "${booking_id}" && "$(runtime_booking_status "${udid}")" == "${expected_status}" ]]; then
      return 0
    fi
    if (( $(date +%s) - started_at >= timeout_seconds )); then
      log "booking ${booking_id} did not reach status ${expected_status} on ${udid} in ${timeout_seconds}s"
      return 1
    fi
    sleep 2
  done
}

wait_for_transient_type() {
  local udid="$1"
  local expected_type="$2"
  local timeout_seconds="${3:-30}"
  local started_at
  started_at="$(date +%s)"

  while true; do
    if runtime_has_recorded_transient "${udid}" "${expected_type}"; then
      return 0
    fi
    if (( $(date +%s) - started_at >= timeout_seconds )); then
      log "transient type ${expected_type} was not recorded on ${udid} in ${timeout_seconds}s"
      return 1
    fi
    sleep 1
  done
}

wait_for_new_last_transient() {
  local udid="$1"
  local previous_id="$2"
  local expected_type="$3"
  local timeout_seconds="${4:-30}"
  local started_at
  started_at="$(date +%s)"

  while true; do
    local current_id current_type
    current_id="$(runtime_last_transient_id "${udid}")"
    current_type="$(runtime_last_transient_type "${udid}")"
    if [[ -n "${current_id}" && "${current_id}" != "${previous_id}" && "${current_type}" == "${expected_type}" ]]; then
      return 0
    fi
    if (( $(date +%s) - started_at >= timeout_seconds )); then
      log "new transient ${expected_type} did not replace ${previous_id} on ${udid} in ${timeout_seconds}s"
      return 1
    fi
    sleep 1
  done
}

assert_offer_not_visible_for_duration() {
  local udid="$1"
  local booking_id="$2"
  local duration_seconds="${3:-15}"
  local started_at
  started_at="$(date +%s)"

  while true; do
    if runtime_has_offer_booking "${udid}" "${booking_id}" || [[ "$(runtime_active_booking_id "${udid}")" == "${booking_id}" ]]; then
      log "offer ${booking_id} unexpectedly appeared on ${udid}"
      return 1
    fi
    if (( $(date +%s) - started_at >= duration_seconds )); then
      return 0
    fi
    sleep 1
  done
}

capture_device() {
  local udid="$1"
  local output="$2"
  xcrun simctl io "${udid}" screenshot "${output}" >/dev/null
}

run_maestro_flow() {
  local udid="$1"
  local flow_path="$2"
  local output_dir="$3"

  run_with_timeout 120 \
    maestro test "${flow_path}" \
      --udid "${udid}" \
      --no-reinstall-driver \
      --test-output-dir "${output_dir}" >/dev/null
}

build_driver_online_ui_flow() {
  local output_path="$1"
  cat > "${output_path}" <<'EOF'
appId: br.com.leaf.ride
---
- extendedWaitUntil:
    visible:
      id: "driver-home-toggle-online"
    timeout: 90000

- tapOn:
    id: "driver-home-toggle-online"
EOF
}

queue_driver_action() {
  local udid="$1"
  local action="$2"
  local nonce="$3"
  local booking_id="${4:-}"
  local -a args=(
    node "${QUEUE_HOME_AUTOMATION_SCRIPT}"
    --udid "${udid}"
    --app-id "${APP_ID}"
    --role driver
    --action "${action}"
    --nonce "${nonce}"
  )
  if [[ -n "${booking_id}" ]]; then
    args+=(--booking-id "${booking_id}")
  fi
  "${args[@]}"
}

trigger_driver_action() {
  local udid="$1"
  local action="$2"
  local nonce="$3"
  local booking_id="${4:-}"
  local deeplink="leafapp://robotaxi/home?qaAutomation=1&qaDriverAction=${action}&qaNonce=${nonce}"
  if [[ -n "${booking_id}" ]]; then
    deeplink="${deeplink}&qaBookingId=${booking_id}"
  fi
  queue_driver_action "${udid}" "${action}" "${nonce}" "${booking_id}"
  run_with_timeout 10 \
    xcrun simctl openurl "${udid}" \
    "${deeplink}" >/dev/null 2>&1 || true
}

competitive_accept_race() {
  local booking_id="$1"
  local timeout_seconds="${2:-60}"

  trigger_driver_action "${DRIVER_ONE_UDID}" accept_offer "competitive-driver-one-${booking_id}" "${booking_id}" &
  local pid_one=$!
  trigger_driver_action "${DRIVER_TWO_UDID}" accept_offer "competitive-driver-two-${booking_id}" "${booking_id}" &
  local pid_two=$!
  local status_one=0
  local status_two=0
  set +e
  wait "${pid_one}"
  status_one=$?
  wait "${pid_two}"
  status_two=$?
  set -e

  if [[ "${status_one}" -ne 0 || "${status_two}" -ne 0 ]]; then
    log "competitive accept triggers failed (driver1=${status_one}, driver2=${status_two})"
    return 1
  fi

  local winner_udid=""
  local loser_udid=""
  local started_at
  started_at="$(date +%s)"
  while true; do
    local driver_one_status driver_two_status
    local driver_one_booking driver_two_booking
    driver_one_status="$(runtime_booking_status "${DRIVER_ONE_UDID}")"
    driver_two_status="$(runtime_booking_status "${DRIVER_TWO_UDID}")"
    driver_one_booking="$(runtime_active_booking_id "${DRIVER_ONE_UDID}")"
    driver_two_booking="$(runtime_active_booking_id "${DRIVER_TWO_UDID}")"

    if [[ "${driver_one_status}" == "accepted" && "${driver_one_booking}" == "${booking_id}" ]]; then
      winner_udid="${DRIVER_ONE_UDID}"
      loser_udid="${DRIVER_TWO_UDID}"
      break
    fi
    if [[ "${driver_two_status}" == "accepted" && "${driver_two_booking}" == "${booking_id}" ]]; then
      winner_udid="${DRIVER_TWO_UDID}"
      loser_udid="${DRIVER_ONE_UDID}"
      break
    fi
    if (( $(date +%s) - started_at >= timeout_seconds )); then
      log "competitive accept did not produce a clear winner in time"
      return 1
    fi
    sleep 2
  done

  printf '%s|%s\n' "${winner_udid}" "${loser_udid}"
}

terminate_app() {
  local udid="$1"
  run_with_timeout 10 xcrun simctl terminate "${udid}" "${APP_ID}" >/dev/null 2>&1 || true
}

seed_driver_auth_for_udid() {
  local udid="$1"
  local profile_key="$2"
  node "${SEED_AUTH_SCRIPT}" --udid "${udid}" --app-id "${APP_ID}" --role driver --profile-key "${profile_key}"
}

wait_for_socket_auth() {
  local udid="$1"
  local timeout_seconds="${2:-45}"
  local started_at
  started_at="$(date +%s)"

  while true; do
    if [[ "$(runtime_socket_authenticated "${udid}")" == "true" ]]; then
      return 0
    fi
    if (( $(date +%s) - started_at >= timeout_seconds )); then
      log "driver ${udid} did not authenticate socket in ${timeout_seconds}s"
      return 1
    fi
    sleep 2
  done
}

bootstrap_driver_for_scenario() {
  local udid="$1"
  local profile_key="$2"
  local initial_action="${3:-}"
  local initial_nonce="${4:-bootstrap-${profile_key}}"

  terminate_app "${udid}"
  seed_driver_auth_for_udid "${udid}" "${profile_key}"
  reset_runtime_state "${udid}" driver
  if [[ -n "${initial_action}" ]]; then
    queue_driver_action "${udid}" "${initial_action}" "${initial_nonce}"
  fi
  foreground_app "${udid}" "${FLOW_SETTLE_SECONDS}"
  wait_for_socket_auth "${udid}" 45
}

relaunch_driver_with_persisted_action() {
  local udid="$1"
  local action="$2"
  local nonce="$3"
  local booking_id="${4:-}"

  terminate_app "${udid}"
  queue_driver_action "${udid}" "${action}" "${nonce}" "${booking_id}"
  foreground_app "${udid}" "${FLOW_SETTLE_SECONDS}"
  wait_for_socket_auth "${udid}" 45
}

prepare_drivers() {
  local slug="$1"
  local driver_one_online_flow="${ARTIFACTS_DIR}/${slug}-driver-one-online-ui.yaml"
  local driver_two_online_flow="${ARTIFACTS_DIR}/${slug}-driver-two-online-ui.yaml"
  log "preparing drivers for ${slug}"
  cleanup_remote_runtime_state

  bootstrap_driver_for_scenario "${DRIVER_ONE_UDID}" "driver" "set_online" "${slug}-driver-one-bootstrap-online"
  bootstrap_driver_for_scenario "${DRIVER_TWO_UDID}" "driverTwo" "set_online" "${slug}-driver-two-bootstrap-online"

  if wait_for_online "${DRIVER_ONE_UDID}" 25 && wait_for_online "${DRIVER_TWO_UDID}" 25; then
    sleep "${FLOW_SETTLE_SECONDS}"
    return 0
  fi

  build_driver_online_ui_flow "${driver_one_online_flow}"
  build_driver_online_ui_flow "${driver_two_online_flow}"

  if ! run_maestro_flow \
    "${DRIVER_ONE_UDID}" \
    "${driver_one_online_flow}" \
    "${ARTIFACTS_DIR}/${slug}-driver-one-online-ui"; then
    log "driver one online via UI failed; falling back to queued automation"
    trigger_driver_action "${DRIVER_ONE_UDID}" set_online "${slug}-driver-one-online"
  fi

  if ! run_maestro_flow \
    "${DRIVER_TWO_UDID}" \
    "${driver_two_online_flow}" \
    "${ARTIFACTS_DIR}/${slug}-driver-two-online-ui"; then
    log "driver two online via UI failed; falling back to queued automation"
    trigger_driver_action "${DRIVER_TWO_UDID}" set_online "${slug}-driver-two-online"
  fi

  wait_for_online "${DRIVER_ONE_UDID}" 60
  wait_for_online "${DRIVER_TWO_UDID}" 60
  sleep "${FLOW_SETTLE_SECONDS}"
}

create_bookings_from_file() {
  local rides_file="$1"
  local output_json="$2"
  local delay_ms_between="${3:-0}"
  local stdout_file="${output_json}.stdout"
  local stderr_file="${output_json}.stderr"
  rm -f "${stdout_file}" "${stderr_file}"

  (
    cd "${BACKEND_DIR}" && \
      API_BASE_URL="${API_BASE_URL}" \
      WS_URL="${WS_URL}" \
      TEST_PASSENGER_UID="${PASSENGER_UID}" \
      TEST_PASSENGER_TWO_UID="${PASSENGER_TWO_UID}" \
      TEST_PASSENGER_THREE_UID="${PASSENGER_THREE_UID}" \
      TEST_PASSENGER_FOUR_UID="${PASSENGER_FOUR_UID}" \
      node scripts/tests/create-passenger-bookings.cjs \
        --rides-file "${rides_file}" \
        --delay-ms-between "${delay_ms_between}"
  ) > "${stdout_file}" 2> "${stderr_file}"
  local status=$?

  if [[ -s "${stdout_file}" ]]; then
    mv "${stdout_file}" "${output_json}"
  else
    : > "${output_json}"
    rm -f "${stdout_file}"
  fi

  if [[ "${status}" -ne 0 && ! -s "${output_json}" && -s "${stderr_file}" ]]; then
    cp "${stderr_file}" "${output_json}"
  fi

  if [[ "${status}" -eq 0 ]]; then
    rm -f "${stderr_file}"
  fi

  return "${status}"
}

create_bookings_from_file_with_retry() {
  local rides_file="$1"
  local output_json="$2"
  local delay_ms_between="${3:-0}"
  local max_attempts="${4:-3}"
  local attempt=1

  while true; do
    set +e
    create_bookings_from_file "${rides_file}" "${output_json}" "${delay_ms_between}"
    local status=$?
    set -e

    if [[ "${status}" -eq 0 ]]; then
      return 0
    fi

    if (( attempt >= max_attempts )); then
      return "${status}"
    fi

    if ! grep -q "Não há motoristas disponíveis para a categoria selecionada" "${output_json}" 2>/dev/null; then
      return "${status}"
    fi

    log "booking creation reported no drivers on attempt ${attempt}/${max_attempts}; retrying after cooldown"
    attempt=$((attempt + 1))
    sleep 4
  done
}

booking_id_for_label() {
  node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const label=process.argv[2];const entry=(data.rides||[]).find((item)=>String(item.label||'')===label);process.stdout.write(String(entry?.bookingId||''));" "$1" "$2"
}

write_json_file() {
  local output="$1"
  local json="$2"
  printf '%s\n' "${json}" > "${output}"
}

write_single_ride_file() {
  local source_rides_file="$1"
  local label="$2"
  local output_file="$3"

  node -e "const fs=require('fs');const rides=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const label=process.argv[2];const ride=(Array.isArray(rides)?rides:[]).find((item)=>String(item.label||'')===label);if(!ride){process.exit(2);}process.stdout.write(JSON.stringify([ride],null,2));" "${source_rides_file}" "${label}" > "${output_file}"
}

scenario_single_accept_clears_other() {
  local scenario_dir="${ARTIFACTS_DIR}/scenario-1-single-accept-clears-other"
  local rides_file="${scenario_dir}/rides.json"
  local bookings_json="${scenario_dir}/bookings.json"
  mkdir -p "${scenario_dir}"
  log "running scenario 1: single accept clears the other driver"

  prepare_drivers "scenario1"

  cat > "${rides_file}" <<'EOF'
[
  {
    "label": "single-offer",
    "fare": 24.9,
    "pickup": {
      "lat": -22.971964,
      "lng": -43.182543,
      "address": "Copacabana Palace, Rio de Janeiro, RJ"
    },
    "destination": {
      "lat": -22.984926,
      "lng": -43.20456,
      "address": "Ipanema, Rio de Janeiro, RJ"
    }
  }
]
EOF

  create_bookings_from_file "${rides_file}" "${bookings_json}" 0
  local booking_id
  booking_id="$(booking_id_for_label "${bookings_json}" "single-offer")"

  wait_for_offer_visible "${DRIVER_ONE_UDID}" "${booking_id}" 60
  wait_for_offer_visible "${DRIVER_TWO_UDID}" "${booking_id}" 60
  capture_device "${DRIVER_ONE_UDID}" "${scenario_dir}/before-driver-one.png"
  capture_device "${DRIVER_TWO_UDID}" "${scenario_dir}/before-driver-two.png"

  trigger_driver_action "${DRIVER_ONE_UDID}" accept_offer "scenario1-accept"
  wait_for_booking_status "${DRIVER_ONE_UDID}" "${booking_id}" "accepted" 60
  wait_for_offer_absent "${DRIVER_TWO_UDID}" "${booking_id}" 60

  sleep "${STABILIZATION_SECONDS}"
  capture_device "${DRIVER_ONE_UDID}" "${scenario_dir}/after-driver-one.png"
  capture_device "${DRIVER_TWO_UDID}" "${scenario_dir}/after-driver-two.png"

  local transient_type_driver_two
  transient_type_driver_two="$(runtime_transient_type "${DRIVER_TWO_UDID}")"
  cat > "${scenario_dir}/result.json" <<EOF
{
  "scenario": "single_accept_clears_other",
  "ok": true,
  "bookingId": "${booking_id}",
  "driverOneUid": "${DRIVER_ONE_UID}",
  "driverTwoUid": "${DRIVER_TWO_UID}",
  "driverOneStatus": "$(runtime_booking_status "${DRIVER_ONE_UDID}")",
  "driverTwoStatus": "$(runtime_booking_status "${DRIVER_TWO_UDID}")",
  "driverTwoTransientType": "${transient_type_driver_two}"
}
EOF
}

scenario_competitive_accept_notice() {
  local scenario_dir="${ARTIFACTS_DIR}/scenario-2-competitive-accept-notice"
  local rides_file="${scenario_dir}/rides.json"
  local bookings_json="${scenario_dir}/bookings.json"
  mkdir -p "${scenario_dir}"
  log "running scenario 2: competitive accept shows loser notice"

  prepare_drivers "scenario2"

  cat > "${rides_file}" <<'EOF'
[
  {
    "label": "competitive-offer",
    "fare": 31.4,
    "pickup": {
      "lat": -22.951916,
      "lng": -43.180753,
      "address": "Botafogo, Rio de Janeiro, RJ"
    },
    "destination": {
      "lat": -22.903539,
      "lng": -43.209587,
      "address": "Centro, Rio de Janeiro, RJ"
    }
  }
]
EOF

  create_bookings_from_file "${rides_file}" "${bookings_json}" 0
  local booking_id
  booking_id="$(booking_id_for_label "${bookings_json}" "competitive-offer")"

  wait_for_offer_visible "${DRIVER_ONE_UDID}" "${booking_id}" 60
  wait_for_offer_visible "${DRIVER_TWO_UDID}" "${booking_id}" 60
  capture_device "${DRIVER_ONE_UDID}" "${scenario_dir}/before-driver-one.png"
  capture_device "${DRIVER_TWO_UDID}" "${scenario_dir}/before-driver-two.png"

  local driver_one_probe_before driver_two_probe_before
  driver_one_probe_before="$(runtime_debug_probe_count "${DRIVER_ONE_UDID}" "driver_accept_offer_remote_error" "aceita por outro motorista")"
  driver_two_probe_before="$(runtime_debug_probe_count "${DRIVER_TWO_UDID}" "driver_accept_offer_remote_error" "aceita por outro motorista")"

  local race_result winner_udid loser_udid
  race_result="$(competitive_accept_race "${booking_id}" 60)"
  winner_udid="${race_result%%|*}"
  loser_udid="${race_result##*|}"

  wait_for_offer_absent "${loser_udid}" "${booking_id}" 60
  if [[ "${loser_udid}" == "${DRIVER_ONE_UDID}" ]]; then
    wait_for_runtime_debug_probe_count "${loser_udid}" "driver_accept_offer_remote_error" "$((driver_one_probe_before + 1))" "aceita por outro motorista" 30
  else
    wait_for_runtime_debug_probe_count "${loser_udid}" "driver_accept_offer_remote_error" "$((driver_two_probe_before + 1))" "aceita por outro motorista" 30
  fi

  capture_device "${DRIVER_ONE_UDID}" "${scenario_dir}/after-driver-one.png"
  capture_device "${DRIVER_TWO_UDID}" "${scenario_dir}/after-driver-two.png"
  sleep 1

  cat > "${scenario_dir}/result.json" <<EOF
{
  "scenario": "competitive_accept_notice",
  "ok": true,
  "bookingId": "${booking_id}",
  "winnerUdid": "${winner_udid}",
  "winnerUid": "$([[ "${winner_udid}" == "${DRIVER_ONE_UDID}" ]] && printf '%s' "${DRIVER_ONE_UID}" || printf '%s' "${DRIVER_TWO_UID}")",
  "loserUdid": "${loser_udid}",
  "loserUid": "$([[ "${loser_udid}" == "${DRIVER_ONE_UDID}" ]] && printf '%s' "${DRIVER_ONE_UID}" || printf '%s' "${DRIVER_TWO_UID}")",
  "loserCompetitiveProbeCount": "$(runtime_debug_probe_count "${loser_udid}" "driver_accept_offer_remote_error" "aceita por outro motorista")",
  "loserTransientType": "$(runtime_transient_type "${loser_udid}")",
  "loserLastTransientType": "$(runtime_last_transient_type "${loser_udid}")",
  "loserLastTransientId": "$(runtime_last_transient_id "${loser_udid}")"
}
EOF
}

scenario_multi_offer_queue_probe() {
  local scenario_dir="${ARTIFACTS_DIR}/scenario-3-multi-offer-queue-probe"
  local rides_file="${scenario_dir}/rides.json"
  mkdir -p "${scenario_dir}"
  log "running scenario 3: queued offers after sequential rejections"

  prepare_drivers "scenario3"

  cat > "${rides_file}" <<'EOF'
[
  {
    "label": "far-first",
    "passengerKey": "passenger",
    "fare": 42.8,
    "pickup": {
      "lat": -22.971964,
      "lng": -43.182543,
      "address": "Embarque distante 1, Copacabana Palace, Rio de Janeiro, RJ"
    },
    "destination": {
      "lat": -23.00037,
      "lng": -43.365895,
      "address": "Barra da Tijuca, Rio de Janeiro, RJ"
    }
  },
  {
    "label": "near-second",
    "passengerKey": "passengerTwo",
    "fare": 18.6,
    "pickup": {
      "lat": -22.984926,
      "lng": -43.20456,
      "address": "Embarque próximo 2, Ipanema, Rio de Janeiro, RJ"
    },
    "destination": {
      "lat": -22.984843,
      "lng": -43.221972,
      "address": "Leblon, Rio de Janeiro, RJ"
    }
  },
  {
    "label": "mid-third",
    "passengerKey": "passengerThree",
    "fare": 27.4,
    "pickup": {
      "lat": -22.951916,
      "lng": -43.180753,
      "address": "Embarque intermediário 3, Botafogo, Rio de Janeiro, RJ"
    },
    "destination": {
      "lat": -22.924932,
      "lng": -43.232168,
      "address": "Tijuca, Rio de Janeiro, RJ"
    }
  },
  {
    "label": "close-fourth",
    "passengerKey": "passengerFour",
    "fare": 22.1,
    "pickup": {
      "lat": -22.929508,
      "lng": -43.176044,
      "address": "Embarque muito próximo 4, Flamengo, Rio de Janeiro, RJ"
    },
    "destination": {
      "lat": -22.903539,
      "lng": -43.209587,
      "address": "Centro, Rio de Janeiro, RJ"
    }
  }
]
EOF

  local batch_attempt_json="${scenario_dir}/batch-create-attempt.json"
  local concurrent_queue_supported="true"
  local concurrent_queue_error=""
  set +e
  create_bookings_from_file "${rides_file}" "${batch_attempt_json}" 1500
  local batch_status=$?
  set -e
  if [[ "${batch_status}" -ne 0 ]]; then
    concurrent_queue_supported="false"
    concurrent_queue_error="$(node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(String(data.error||''));" "${batch_attempt_json}" 2>/dev/null || true)"
  fi

  local booking_far="" booking_near="" booking_mid="" booking_close=""
  local driver_one_labels=()
  local driver_two_labels=()

  local far_single_file="${scenario_dir}/far-first-single.json"
  local far_booking_json="${scenario_dir}/far-first-booking.json"
  write_single_ride_file "${rides_file}" "far-first" "${far_single_file}"
  create_bookings_from_file_with_retry "${far_single_file}" "${far_booking_json}" 0 4
  booking_far="$(booking_id_for_label "${far_booking_json}" "far-first")"
  wait_for_offer_visible "${DRIVER_ONE_UDID}" "${booking_far}" 60
  wait_for_offer_visible "${DRIVER_TWO_UDID}" "${booking_far}" 60
  driver_one_labels+=("far-first")
  driver_two_labels+=("far-first")
  capture_device "${DRIVER_ONE_UDID}" "${scenario_dir}/step-1-driver-one.png"
  capture_device "${DRIVER_TWO_UDID}" "${scenario_dir}/step-1-driver-two.png"
  trigger_driver_action "${DRIVER_ONE_UDID}" reject_offer "scenario3-step1-driver-one-reject" "${booking_far}"
  trigger_driver_action "${DRIVER_TWO_UDID}" reject_offer "scenario3-step1-driver-two-reject" "${booking_far}"
  wait_for_offer_absent "${DRIVER_ONE_UDID}" "${booking_far}" 60
  wait_for_offer_absent "${DRIVER_TWO_UDID}" "${booking_far}" 60
  sleep 3

  local near_single_file="${scenario_dir}/near-second-single.json"
  local near_booking_json="${scenario_dir}/near-second-booking.json"
  write_single_ride_file "${rides_file}" "near-second" "${near_single_file}"
  create_bookings_from_file_with_retry "${near_single_file}" "${near_booking_json}" 0 4
  booking_near="$(booking_id_for_label "${near_booking_json}" "near-second")"
  wait_for_offer_visible "${DRIVER_ONE_UDID}" "${booking_near}" 60
  wait_for_offer_visible "${DRIVER_TWO_UDID}" "${booking_near}" 60
  driver_one_labels+=("near-second")
  driver_two_labels+=("near-second")
  capture_device "${DRIVER_ONE_UDID}" "${scenario_dir}/step-2-driver-one.png"
  capture_device "${DRIVER_TWO_UDID}" "${scenario_dir}/step-2-driver-two.png"
  trigger_driver_action "${DRIVER_ONE_UDID}" reject_offer "scenario3-step2-driver-one-reject" "${booking_near}"
  trigger_driver_action "${DRIVER_TWO_UDID}" reject_offer "scenario3-step2-driver-two-reject" "${booking_near}"
  wait_for_offer_absent "${DRIVER_ONE_UDID}" "${booking_near}" 60
  wait_for_offer_absent "${DRIVER_TWO_UDID}" "${booking_near}" 60
  sleep 3

  local mid_single_file="${scenario_dir}/mid-third-single.json"
  local mid_booking_json="${scenario_dir}/mid-third-booking.json"
  write_single_ride_file "${rides_file}" "mid-third" "${mid_single_file}"
  create_bookings_from_file_with_retry "${mid_single_file}" "${mid_booking_json}" 0 4
  booking_mid="$(booking_id_for_label "${mid_booking_json}" "mid-third")"
  wait_for_offer_visible "${DRIVER_ONE_UDID}" "${booking_mid}" 60
  wait_for_offer_visible "${DRIVER_TWO_UDID}" "${booking_mid}" 60
  driver_one_labels+=("mid-third")
  driver_two_labels+=("mid-third")
  capture_device "${DRIVER_ONE_UDID}" "${scenario_dir}/step-3-driver-one.png"
  capture_device "${DRIVER_TWO_UDID}" "${scenario_dir}/step-3-driver-two.png"
  trigger_driver_action "${DRIVER_ONE_UDID}" accept_offer "scenario3-step3-driver-one-accept" "${booking_mid}"
  wait_for_booking_status "${DRIVER_ONE_UDID}" "${booking_mid}" "accepted" 60
  wait_for_offer_absent "${DRIVER_TWO_UDID}" "${booking_mid}" 60
  sleep 3

  local close_single_file="${scenario_dir}/close-fourth-single.json"
  local close_booking_json="${scenario_dir}/close-fourth-booking.json"
  write_single_ride_file "${rides_file}" "close-fourth" "${close_single_file}"
  create_bookings_from_file_with_retry "${close_single_file}" "${close_booking_json}" 0 4
  booking_close="$(booking_id_for_label "${close_booking_json}" "close-fourth")"
  wait_for_offer_visible "${DRIVER_TWO_UDID}" "${booking_close}" 60
  driver_two_labels+=("close-fourth")
  capture_device "${DRIVER_ONE_UDID}" "${scenario_dir}/step-4-driver-one-busy.png"
  capture_device "${DRIVER_TWO_UDID}" "${scenario_dir}/step-4-driver-two.png"
  trigger_driver_action "${DRIVER_TWO_UDID}" accept_offer "scenario3-step4-driver-two-accept" "${booking_close}"
  wait_for_booking_status "${DRIVER_TWO_UDID}" "${booking_close}" "accepted" 60
  capture_device "${DRIVER_ONE_UDID}" "${scenario_dir}/step-5-driver-one-final.png"
  capture_device "${DRIVER_TWO_UDID}" "${scenario_dir}/step-5-driver-two-final.png"

  local driver_one_labels_json driver_two_labels_json
  driver_one_labels_json="$(printf '%s\n' "${driver_one_labels[@]}" | node -e "const fs=require('fs');const items=fs.readFileSync(0,'utf8').split(/\n/).map((line)=>line.trim()).filter(Boolean);process.stdout.write(JSON.stringify(items));")"
  driver_two_labels_json="$(printf '%s\n' "${driver_two_labels[@]}" | node -e "const fs=require('fs');const items=fs.readFileSync(0,'utf8').split(/\n/).map((line)=>line.trim()).filter(Boolean);process.stdout.write(JSON.stringify(items));")"

  cat > "${scenario_dir}/result.json" <<EOF
{
  "scenario": "multi_offer_queue_probe",
  "ok": true,
  "concurrentQueueSupported": ${concurrent_queue_supported},
  "concurrentQueueAttemptError": "$(printf '%s' "${concurrent_queue_error}" | sed 's/"/\\"/g')",
  "bookingIds": {
    "farFirst": "${booking_far}",
    "nearSecond": "${booking_near}",
    "midThird": "${booking_mid}",
    "closeFourth": "${booking_close}"
  },
  "driverOneObservedLabels": ${driver_one_labels_json},
  "driverTwoObservedLabels": ${driver_two_labels_json},
  "driverOneAcceptedBookingId": "${booking_mid}",
  "driverTwoAcceptedBookingId": "${booking_close}",
  "driverOneFinalStatus": "$(runtime_booking_status "${DRIVER_ONE_UDID}")",
  "driverTwoFinalStatus": "$(runtime_booking_status "${DRIVER_TWO_UDID}")"
}
EOF
}

scenario_dual_reject_stays_online() {
  local scenario_dir="${ARTIFACTS_DIR}/scenario-4-dual-reject-stays-online"
  local rides_file="${scenario_dir}/rides.json"
  mkdir -p "${scenario_dir}"
  log "running scenario 4: both drivers reject and stay online for next offer"

  prepare_drivers "scenario4"

  cat > "${rides_file}" <<'EOF'
[
  {
    "label": "reject-first",
    "passengerKey": "passenger",
    "fare": 19.8,
    "pickup": {
      "lat": -22.929508,
      "lng": -43.176044,
      "address": "Oferta inicial para recusa, Flamengo, Rio de Janeiro, RJ"
    },
    "destination": {
      "lat": -22.984843,
      "lng": -43.221972,
      "address": "Destino inicial após recusa, Leblon, Rio de Janeiro, RJ"
    }
  },
  {
    "label": "reject-followup",
    "passengerKey": "passengerTwo",
    "fare": 23.4,
    "pickup": {
      "lat": -22.971964,
      "lng": -43.182543,
      "address": "Nova oferta após recusa, Copacabana, Rio de Janeiro, RJ"
    },
    "destination": {
      "lat": -23.00037,
      "lng": -43.365895,
      "address": "Destino de follow-up, Barra da Tijuca, Rio de Janeiro, RJ"
    }
  }
]
EOF

  local first_single_file="${scenario_dir}/reject-first-single.json"
  local first_booking_json="${scenario_dir}/reject-first-booking.json"
  write_single_ride_file "${rides_file}" "reject-first" "${first_single_file}"
  create_bookings_from_file_with_retry "${first_single_file}" "${first_booking_json}" 0 4
  local first_booking_id
  first_booking_id="$(booking_id_for_label "${first_booking_json}" "reject-first")"

  wait_for_offer_visible "${DRIVER_ONE_UDID}" "${first_booking_id}" 60
  wait_for_offer_visible "${DRIVER_TWO_UDID}" "${first_booking_id}" 60
  capture_device "${DRIVER_ONE_UDID}" "${scenario_dir}/before-reject-driver-one.png"
  capture_device "${DRIVER_TWO_UDID}" "${scenario_dir}/before-reject-driver-two.png"

  trigger_driver_action "${DRIVER_ONE_UDID}" reject_offer "scenario4-driver-one-reject" "${first_booking_id}"
  trigger_driver_action "${DRIVER_TWO_UDID}" reject_offer "scenario4-driver-two-reject" "${first_booking_id}"
  wait_for_offer_absent "${DRIVER_ONE_UDID}" "${first_booking_id}" 60
  wait_for_offer_absent "${DRIVER_TWO_UDID}" "${first_booking_id}" 60
  wait_for_online "${DRIVER_ONE_UDID}" 45
  wait_for_online "${DRIVER_TWO_UDID}" 45

  capture_device "${DRIVER_ONE_UDID}" "${scenario_dir}/after-reject-driver-one.png"
  capture_device "${DRIVER_TWO_UDID}" "${scenario_dir}/after-reject-driver-two.png"

  local followup_single_file="${scenario_dir}/reject-followup-single.json"
  local followup_booking_json="${scenario_dir}/reject-followup-booking.json"
  write_single_ride_file "${rides_file}" "reject-followup" "${followup_single_file}"
  create_bookings_from_file_with_retry "${followup_single_file}" "${followup_booking_json}" 0 4
  local followup_booking_id
  followup_booking_id="$(booking_id_for_label "${followup_booking_json}" "reject-followup")"

  wait_for_offer_visible "${DRIVER_ONE_UDID}" "${followup_booking_id}" 60
  wait_for_offer_visible "${DRIVER_TWO_UDID}" "${followup_booking_id}" 60
  capture_device "${DRIVER_ONE_UDID}" "${scenario_dir}/followup-visible-driver-one.png"
  capture_device "${DRIVER_TWO_UDID}" "${scenario_dir}/followup-visible-driver-two.png"

  trigger_driver_action "${DRIVER_ONE_UDID}" accept_offer "scenario4-driver-one-accept-followup" "${followup_booking_id}"
  wait_for_booking_status "${DRIVER_ONE_UDID}" "${followup_booking_id}" "accepted" 60
  wait_for_offer_absent "${DRIVER_TWO_UDID}" "${followup_booking_id}" 60

  cat > "${scenario_dir}/result.json" <<EOF
{
  "scenario": "dual_reject_stays_online",
  "ok": true,
  "firstBookingId": "${first_booking_id}",
  "followupBookingId": "${followup_booking_id}",
  "driverOneOnlineAfterReject": "$(runtime_driver_online "${DRIVER_ONE_UDID}")",
  "driverTwoOnlineAfterReject": "$(runtime_driver_online "${DRIVER_TWO_UDID}")",
  "driverOneFollowupStatus": "$(runtime_booking_status "${DRIVER_ONE_UDID}")",
  "driverTwoFollowupActiveBookingId": "$(runtime_active_booking_id "${DRIVER_TWO_UDID}")"
}
EOF
}

scenario_late_reaccept_blocked() {
  local scenario_dir="${ARTIFACTS_DIR}/scenario-5-late-reaccept-blocked"
  local rides_file="${scenario_dir}/rides.json"
  local bookings_json="${scenario_dir}/bookings.json"
  mkdir -p "${scenario_dir}"
  log "running scenario 5: loser retry stays blocked after another driver wins"

  prepare_drivers "scenario5"

  cat > "${rides_file}" <<'EOF'
[
  {
    "label": "late-reaccept-offer",
    "fare": 28.7,
    "pickup": {
      "lat": -22.984926,
      "lng": -43.20456,
      "address": "Oferta em disputa com retry tardio, Ipanema, Rio de Janeiro, RJ"
    },
    "destination": {
      "lat": -22.924932,
      "lng": -43.232168,
      "address": "Destino retry tardio, Tijuca, Rio de Janeiro, RJ"
    }
  }
]
EOF

  create_bookings_from_file "${rides_file}" "${bookings_json}" 0
  local booking_id
  booking_id="$(booking_id_for_label "${bookings_json}" "late-reaccept-offer")"

  wait_for_offer_visible "${DRIVER_ONE_UDID}" "${booking_id}" 60
  wait_for_offer_visible "${DRIVER_TWO_UDID}" "${booking_id}" 60
  capture_device "${DRIVER_ONE_UDID}" "${scenario_dir}/before-driver-one.png"
  capture_device "${DRIVER_TWO_UDID}" "${scenario_dir}/before-driver-two.png"

  local winner_udid="${DRIVER_ONE_UDID}"
  local loser_udid="${DRIVER_TWO_UDID}"
  local loser_probe_before
  loser_probe_before="$(runtime_debug_probe_count "${loser_udid}" "driver_accept_offer_remote_error" "aceita por outro motorista")"

  relaunch_driver_with_persisted_action "${winner_udid}" accept_offer "scenario5-initial-winner" "${booking_id}"
  wait_for_booking_status "${winner_udid}" "${booking_id}" "accepted" 60
  wait_for_offer_absent "${loser_udid}" "${booking_id}" 60
  local competitive_probe_count_after_race="${loser_probe_before}"
  capture_device "${loser_udid}" "${scenario_dir}/loser-after-race.png"

  relaunch_driver_with_persisted_action "${loser_udid}" accept_offer "scenario5-loser-retry" "${booking_id}"
  wait_for_runtime_debug_probe_count "${loser_udid}" "driver_accept_offer_remote_error" "$((competitive_probe_count_after_race + 1))" "aceita por outro motorista" 30
  sleep 1
  capture_device "${loser_udid}" "${scenario_dir}/loser-after-retry.png"

  cat > "${scenario_dir}/result.json" <<EOF
{
  "scenario": "late_reaccept_blocked",
  "ok": true,
  "bookingId": "${booking_id}",
  "winnerUdid": "${winner_udid}",
  "loserUdid": "${loser_udid}",
  "winnerBookingStatus": "$(runtime_booking_status "${winner_udid}")",
  "loserBookingStatus": "$(runtime_booking_status "${loser_udid}")",
  "loserActiveBookingId": "$(runtime_active_booking_id "${loser_udid}")",
  "competitiveProbeCountAfterRace": "${competitive_probe_count_after_race}",
  "competitiveProbeCountAfterRetry": "$(runtime_debug_probe_count "${loser_udid}" "driver_accept_offer_remote_error" "aceita por outro motorista")",
  "loserLastTransientType": "$(runtime_last_transient_type "${loser_udid}")"
}
EOF
}

scenario_reconnect_mid_dispute() {
  local scenario_dir="${ARTIFACTS_DIR}/scenario-6-reconnect-mid-dispute"
  local rides_file="${scenario_dir}/rides.json"
  mkdir -p "${scenario_dir}"
  log "running scenario 6: reconnecting driver restores offer and clears after rival accept"

  prepare_drivers "scenario6"

  cat > "${rides_file}" <<'EOF'
[
  {
    "label": "reconnect-shared",
    "passengerKey": "passenger",
    "fare": 25.9,
    "pickup": {
      "lat": -22.951916,
      "lng": -43.180753,
      "address": "Oferta compartilhada para reconnect, Botafogo, Rio de Janeiro, RJ"
    },
    "destination": {
      "lat": -22.984843,
      "lng": -43.221972,
      "address": "Destino da disputa reconnect, Leblon, Rio de Janeiro, RJ"
    }
  },
  {
    "label": "reconnect-followup",
    "passengerKey": "passengerTwo",
    "fare": 21.7,
    "pickup": {
      "lat": -22.929508,
      "lng": -43.176044,
      "address": "Oferta nova após reconnect, Flamengo, Rio de Janeiro, RJ"
    },
    "destination": {
      "lat": -22.903539,
      "lng": -43.209587,
      "address": "Destino da oferta nova pós-reconnect, Centro, Rio de Janeiro, RJ"
    }
  }
]
EOF

  local shared_single_file="${scenario_dir}/reconnect-shared-single.json"
  local shared_booking_json="${scenario_dir}/reconnect-shared-booking.json"
  write_single_ride_file "${rides_file}" "reconnect-shared" "${shared_single_file}"
  create_bookings_from_file_with_retry "${shared_single_file}" "${shared_booking_json}" 0 4
  local shared_booking_id
  shared_booking_id="$(booking_id_for_label "${shared_booking_json}" "reconnect-shared")"

  wait_for_offer_visible "${DRIVER_ONE_UDID}" "${shared_booking_id}" 60
  wait_for_offer_visible "${DRIVER_TWO_UDID}" "${shared_booking_id}" 60
  capture_device "${DRIVER_ONE_UDID}" "${scenario_dir}/before-reconnect-driver-one.png"
  capture_device "${DRIVER_TWO_UDID}" "${scenario_dir}/before-reconnect-driver-two.png"

  terminate_app "${DRIVER_TWO_UDID}"
  sleep 2
  foreground_app "${DRIVER_TWO_UDID}" "${FLOW_SETTLE_SECONDS}"
  wait_for_socket_auth "${DRIVER_TWO_UDID}" 45
  wait_for_offer_visible "${DRIVER_TWO_UDID}" "${shared_booking_id}" 60
  capture_device "${DRIVER_TWO_UDID}" "${scenario_dir}/after-reconnect-driver-two.png"

  trigger_driver_action "${DRIVER_ONE_UDID}" accept_offer "scenario6-driver-one-accept" "${shared_booking_id}"
  wait_for_booking_status "${DRIVER_ONE_UDID}" "${shared_booking_id}" "accepted" 60
  wait_for_offer_absent "${DRIVER_TWO_UDID}" "${shared_booking_id}" 60
  wait_for_online "${DRIVER_TWO_UDID}" 45

  local followup_single_file="${scenario_dir}/reconnect-followup-single.json"
  local followup_booking_json="${scenario_dir}/reconnect-followup-booking.json"
  write_single_ride_file "${rides_file}" "reconnect-followup" "${followup_single_file}"
  create_bookings_from_file_with_retry "${followup_single_file}" "${followup_booking_json}" 0 4
  local followup_booking_id
  followup_booking_id="$(booking_id_for_label "${followup_booking_json}" "reconnect-followup")"

  wait_for_offer_visible "${DRIVER_TWO_UDID}" "${followup_booking_id}" 60
  assert_offer_not_visible_for_duration "${DRIVER_ONE_UDID}" "${followup_booking_id}" 12
  capture_device "${DRIVER_ONE_UDID}" "${scenario_dir}/followup-driver-one-busy.png"
  capture_device "${DRIVER_TWO_UDID}" "${scenario_dir}/followup-driver-two-visible.png"

  trigger_driver_action "${DRIVER_TWO_UDID}" accept_offer "scenario6-driver-two-accept-followup" "${followup_booking_id}"
  wait_for_booking_status "${DRIVER_TWO_UDID}" "${followup_booking_id}" "accepted" 60

  cat > "${scenario_dir}/result.json" <<EOF
{
  "scenario": "reconnect_mid_dispute",
  "ok": true,
  "sharedBookingId": "${shared_booking_id}",
  "followupBookingId": "${followup_booking_id}",
  "driverTwoSocketAuthenticatedAfterReconnect": "$(runtime_socket_authenticated "${DRIVER_TWO_UDID}")",
  "driverOneSharedStatus": "$(runtime_booking_status "${DRIVER_ONE_UDID}")",
  "driverTwoFollowupStatus": "$(runtime_booking_status "${DRIVER_TWO_UDID}")"
}
EOF
}

write_summary() {
  local summary_file="${ARTIFACTS_DIR}/summary.md"
  cat > "${summary_file}" <<EOF
# Dual-Driver Concurrency Validation

- Data: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
- Driver 1: ${DRIVER_ONE_UID} (${DRIVER_ONE_NAME}) on ${DRIVER_ONE_UDID}
- Driver 2: ${DRIVER_TWO_UID} (${DRIVER_TWO_NAME}) on ${DRIVER_TWO_UDID}
- Passenger seeds: $(passenger_uid_csv)

## Cenários Cobertos

1. Mesma corrida para dois motoristas; um aceita e a corrida some do outro.
2. Aceite competitivo simultâneo; o perdedor precisa receber o aviso \`accepted_by_other_driver_competitive\`.
3. Fila com múltiplas corridas após recusas sucessivas; medimos a sequência observada no app contra:
   - ordem cronológica de criação
   - ordem por distância até o embarque
   - avanço da fila depois de duas recusas e aceite da próxima oferta
4. Ambos recusam uma oferta e o app continua online para receber a próxima corrida.
5. O motorista que perdeu a disputa tenta aceitar de novo e continua bloqueado com aviso consistente.
6. Um motorista reconecta no meio da disputa, restaura a oferta correta e continua apto a receber a próxima quando o outro fica ocupado.

## Cenários Recomendados Para Rodada Seguinte

1. Corrida reofertada após cooldown não pode ressuscitar no app se já foi aceita por outro parceiro.
2. Passageiro cancela no exato momento do aceite para validar qual banner/surface vence no app.
3. Ambos os motoristas recusam sequências maiores com mistura de distâncias e cooldown para validar política de ordenação do backend.
4. Corrida aceita por um motorista e cancelada logo em seguida deve limpar o app do outro sem toast errado.

## Artefatos

- scenario-1-single-accept-clears-other/result.json
- scenario-2-competitive-accept-notice/result.json
- scenario-3-multi-offer-queue-probe/result.json
- scenario-4-dual-reject-stays-online/result.json
- scenario-5-late-reaccept-blocked/result.json
- scenario-6-reconnect-mid-dispute/result.json
EOF
  log "summary written to ${summary_file}"
}

cd "${ROOT_DIR}"
ensure_simulator_window
boot_device "${DRIVER_ONE_UDID}"
boot_device "${DRIVER_TWO_UDID}"
ensure_test_users
reinstall_dual_driver_apps
seed_driver_auths
foreground_app "${DRIVER_ONE_UDID}" "${FLOW_SETTLE_SECONDS}"
foreground_app "${DRIVER_TWO_UDID}" "${FLOW_SETTLE_SECONDS}"

if scenario_enabled 1; then
  scenario_single_accept_clears_other
fi
if scenario_enabled 2; then
  scenario_competitive_accept_notice
fi
if scenario_enabled 3; then
  scenario_multi_offer_queue_probe
fi
if scenario_enabled 4; then
  scenario_dual_reject_stays_online
fi
if scenario_enabled 5; then
  scenario_late_reaccept_blocked
fi
if scenario_enabled 6; then
  scenario_reconnect_mid_dispute
fi
write_summary

cat <<EOF
[dual-driver] done
[dual-driver] artifacts: ${ARTIFACTS_DIR}
EOF
