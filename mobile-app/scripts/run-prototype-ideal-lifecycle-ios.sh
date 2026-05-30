#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MOBILE_DIR="$ROOT_DIR/mobile-app"
QA_PREFLIGHT_USERS_FILE="${MOBILE_DIR}/test-results/qa-preflight/ensure-users.json"

read_ensure_user_field() {
  local role="$1"
  local field="$2"

  if [[ ! -f "$QA_PREFLIGHT_USERS_FILE" ]]; then
    return 0
  fi

  node -e '
    const fs = require("fs");
    const [filePath, role, field] = process.argv.slice(1);
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const value = raw?.[role]?.[field];
      if (value !== undefined && value !== null) {
        process.stdout.write(String(value));
      }
    } catch (_error) {}
  ' "$QA_PREFLIGHT_USERS_FILE" "$role" "$field"
}

read_ensure_other_driver_uids() {
  if [[ ! -f "$QA_PREFLIGHT_USERS_FILE" ]]; then
    return 0
  fi

  node -e '
    const fs = require("fs");
    try {
      const raw = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const values = [raw?.driverTwo?.uid, raw?.driverThree?.uid]
        .map((value) => String(value || "").trim())
        .filter(Boolean);
      process.stdout.write(values.join(","));
    } catch (_error) {}
  ' "$QA_PREFLIGHT_USERS_FILE"
}

DEFAULT_PASSENGER_UID="$(read_ensure_user_field passenger uid)"
DEFAULT_DRIVER_UID="$(read_ensure_user_field driver uid)"
DEFAULT_OTHER_DRIVER_UIDS="$(read_ensure_other_driver_uids)"

ensure_xcode_developer_dir() {
  local preferred_developer_dir="/Applications/Xcode.app/Contents/Developer"
  local current_developer_dir=""

  current_developer_dir="$(xcode-select -p 2>/dev/null || true)"

  if [[ -n "${DEVELOPER_DIR:-}" && -d "${DEVELOPER_DIR}" ]]; then
    return 0
  fi

  if [[ -d "${preferred_developer_dir}" ]]; then
    if [[ "${current_developer_dir}" == "/Library/Developer/CommandLineTools" || -z "${current_developer_dir}" ]]; then
      export DEVELOPER_DIR="${preferred_developer_dir}"
      return 0
    fi

    if ! xcrun simctl help >/dev/null 2>&1; then
      export DEVELOPER_DIR="${preferred_developer_dir}"
      return 0
    fi
  fi
}

ensure_xcode_developer_dir

PASSENGER_UDID="${PASSENGER_UDID:-195D2C57-87DC-4953-ABF1-4FD351ADBBEF}"
DRIVER_UDID="${DRIVER_UDID:-2E44BC8E-9AA8-43BE-BD5E-D0B5A73E543C}"
APP_ID="${APP_ID:-br.com.leaf.ride}"
API_BASE_URL="${API_BASE_URL:-https://api.leaf.app.br}"
REMOTE_HOST="${REMOTE_HOST:-${VPS_HOST:-}}"
REMOTE_KEY="${REMOTE_SSH_KEY:-${VPS_KEY:-${SSH_KEY_PATH:-${REMOTE_KEY:-}}}}"
REMOTE_ENV_PATH="${REMOTE_ENV_PATH:-/opt/leaf-app/.env}"
DRIVER_UID="${DRIVER_UID:-${DEFAULT_DRIVER_UID:-8vg2kxxqi3TYKlpD6eBlWgYseIq2}}"
OTHER_DRIVER_UIDS="${OTHER_DRIVER_UIDS:-${DEFAULT_OTHER_DRIVER_UIDS:-F0CIj7noqrc74qdPJD80T9FCxME2}}"
PASSENGER_PROFILE_KEY="${PASSENGER_PROFILE_KEY:-}"
DRIVER_PROFILE_KEY="${DRIVER_PROFILE_KEY:-}"
PASSENGER_RUNTIME_UID="${PASSENGER_RUNTIME_UID:-${DEFAULT_PASSENGER_UID:-}}"
DRIVER_RUNTIME_UID="${DRIVER_RUNTIME_UID:-${DRIVER_UID}}"
PASSENGER_CURRENT_LAT="${PASSENGER_CURRENT_LAT:-}"
PASSENGER_CURRENT_LNG="${PASSENGER_CURRENT_LNG:-}"
PASSENGER_CURRENT_ADDRESS="${PASSENGER_CURRENT_ADDRESS:-}"
DRIVER_CURRENT_LAT="${DRIVER_CURRENT_LAT:-}"
DRIVER_CURRENT_LNG="${DRIVER_CURRENT_LNG:-}"
DRIVER_CURRENT_ADDRESS="${DRIVER_CURRENT_ADDRESS:-}"
APP_PATH="${APP_PATH:-}"
RELEASE_APP_PATH="$ROOT_DIR/mobile-app/ios/build/Build/Products/Release-iphonesimulator/Leaf.app"
DEBUG_APP_PATH="$ROOT_DIR/mobile-app/ios/build/Build/Products/Debug-iphonesimulator/Leaf.app"
STABILIZATION_SECONDS="${STABILIZATION_SECONDS:-15}"
FLOW_SETTLE_SECONDS="${FLOW_SETTLE_SECONDS:-8}"
DISPATCH_READY_TIMEOUT_SECONDS="${DISPATCH_READY_TIMEOUT_SECONDS:-20}"
SIMCTL_TERMINATE_TIMEOUT_SECONDS="${SIMCTL_TERMINATE_TIMEOUT_SECONDS:-15}"
SIMCTL_UNINSTALL_TIMEOUT_SECONDS="${SIMCTL_UNINSTALL_TIMEOUT_SECONDS:-30}"
SIMCTL_INSTALL_TIMEOUT_SECONDS="${SIMCTL_INSTALL_TIMEOUT_SECONDS:-120}"
METRO_HOST="${METRO_HOST:-127.0.0.1}"
METRO_PORT="${METRO_PORT:-8081}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
ARTIFACTS_DIR="${ARTIFACTS_DIR:-$MOBILE_DIR/.maestro/results/lifecycle_ideal_${TIMESTAMP}}"
SEED_AUTH_SCRIPT="${ROOT_DIR}/scripts/validation/lib/seed-sim-auth.cjs"
QUEUE_HOME_AUTOMATION_SCRIPT="${ROOT_DIR}/scripts/validation/lib/queue-sim-home-automation.cjs"
SEED_PROTOTYPE_STATE_SCRIPT="${ROOT_DIR}/mobile-app/scripts/qa/seed-prototype-ios-state.cjs"
READ_SIM_RUNTIME_SCRIPT="${ROOT_DIR}/scripts/validation/lib/read-sim-runtime-state.cjs"
GUARDED_IOS_LAUNCH_SCRIPT="${ROOT_DIR}/scripts/validation/lib/guarded-ios-launch.sh"
ACCEPT_OPEN_PROMPT_FLOW="${ROOT_DIR}/mobile-app/.maestro/flows/qa/_accept-open-prompt.yaml"

mkdir -p "$ARTIFACTS_DIR"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[lifecycle][error] Missing command: $1"
    exit 1
  fi
}

require_cmd maestro
require_cmd xcrun
require_cmd node
require_cmd curl
require_cmd jq

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

resolve_latest_sim_app_path() {
  if [[ -n "$APP_PATH" ]]; then
    printf '%s\n' "$APP_PATH"
    return
  fi

  local newest_path=""
  local newest_mtime="0"
  local candidate=""
  local candidate_mtime=""

  for candidate in "$DEBUG_APP_PATH" "$RELEASE_APP_PATH"; do
    if [[ ! -d "$candidate" ]]; then
      continue
    fi

    candidate_mtime="$(stat -f '%m' "$candidate" 2>/dev/null || echo 0)"
    if [[ -z "$newest_path" || "$candidate_mtime" -gt "$newest_mtime" ]]; then
      newest_path="$candidate"
      newest_mtime="$candidate_mtime"
    fi
  done

  printf '%s\n' "$newest_path"
}

APP_PATH="$(resolve_latest_sim_app_path)"

if [[ ! -d "$APP_PATH" ]]; then
  echo "[lifecycle][error] App not found in Release or Debug simulator build products."
  exit 1
fi

USE_DEV_CLIENT_DEEPLINK="${USE_DEV_CLIENT_DEEPLINK:-false}"
if [[ "$APP_PATH" == *"/Debug-iphonesimulator/"* ]]; then
  USE_DEV_CLIENT_DEEPLINK="true"
fi

encode_dev_client_url() {
  node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$1"
}

DEV_CLIENT_BUNDLE_URL="http://${METRO_HOST}:${METRO_PORT}"
DEV_CLIENT_DEEPLINK="exp+leafapp-reactnative://expo-development-client/?url=$(encode_dev_client_url "$DEV_CLIENT_BUNDLE_URL")"

dev_client_marker_path() {
  local udid="$1"
  printf '%s\n' "$ARTIFACTS_DIR/_dev_client_attached_${udid}"
}

run_with_timeout() {
  local timeout_seconds="$1"
  shift
  "$@" &
  local cmd_pid=$!
  local started_at
  started_at="$(date +%s)"

  while kill -0 "$cmd_pid" >/dev/null 2>&1; do
    if (( $(date +%s) - started_at >= timeout_seconds )); then
      kill -TERM "$cmd_pid" >/dev/null 2>&1 || true
      sleep 1
      kill -KILL "$cmd_pid" >/dev/null 2>&1 || true
      wait "$cmd_pid" >/dev/null 2>&1 || true
      return 124
    fi
    sleep 1
  done

  wait "$cmd_pid"
}

boot_device() {
  local udid="$1"
  local started_at
  started_at="$(date +%s)"

  if ! xcrun simctl list devices | grep -q "$udid.*(Booted)"; then
    xcrun simctl boot "$udid" >/dev/null 2>&1 || true
  fi

  while ! xcrun simctl list devices | grep -q "$udid.*(Booted)"; do
    if (( $(date +%s) - started_at >= 45 )); then
      echo "[lifecycle][error] Device ${udid} did not reach Booted state in time."
      return 1
    fi
    sleep 2
  done
}

ensure_simulator_window() {
  open -a Simulator >/dev/null 2>&1 || true
}

cleanup_maestro_processes() {
  pkill -f "maestro-driver-iosUITests-Runner" >/dev/null 2>&1 || true
  pkill -f "xcodebuild test-without-building.*maestro-driver-ios-config" >/dev/null 2>&1 || true
}

read_runtime_field() {
  local udid="$1"
  local field="$2"
  node "$READ_SIM_RUNTIME_SCRIPT" --udid "$udid" --app-id "$APP_ID" --field "$field" 2>/dev/null || true
}

read_runtime_snapshot() {
  local udid="$1"
  node "$READ_SIM_RUNTIME_SCRIPT" --udid "$udid" --app-id "$APP_ID" 2>/dev/null || true
}

wait_for_driver_online() {
  local timeout_seconds="${1:-60}"
  local started_at
  local stable_online_samples=0
  started_at="$(date +%s)"

  while true; do
    local driver_online=""
    local driver_online_pending=""

    driver_online="$(read_runtime_field "$DRIVER_UDID" "driverOnline")"
    driver_online_pending="$(read_runtime_field "$DRIVER_UDID" "driverOnlinePending")"

    if [[ "$driver_online" == "true" && "$driver_online_pending" != "true" ]]; then
      stable_online_samples=$((stable_online_samples + 1))
      if (( stable_online_samples >= 3 )); then
        return 0
      fi
    else
      stable_online_samples=0
    fi

    if (( $(date +%s) - started_at >= timeout_seconds )); then
      echo "[lifecycle][error] Driver did not stabilize online in ${timeout_seconds}s (online=${driver_online:-unknown}, pending=${driver_online_pending:-unknown})"
      return 1
    fi

    sleep 2
  done
}

RUNTIME_ADMIN_TOKEN="${RUNTIME_ADMIN_TOKEN:-}"

load_runtime_admin_token() {
  if [[ -n "$RUNTIME_ADMIN_TOKEN" ]]; then
    return 0
  fi

  if [[ -z "$REMOTE_HOST" ]] || [[ ! -f "$REMOTE_KEY" ]]; then
    echo "[lifecycle][warn] Missing remote host/key; dispatch-ready polling will skip token fetch."
    return 1
  fi

  if ! have_cmd ssh; then
    echo "[lifecycle][warn] Missing ssh; dispatch-ready polling will skip token fetch."
    return 1
  fi

  local token=""
  token="$(
    ssh -i "$REMOTE_KEY" -o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout=8 "root@${REMOTE_HOST}" \
      "grep -E '^(RUNTIME_ADMIN_TOKEN)=' '${REMOTE_ENV_PATH}' | head -n 1 | cut -d= -f2-" 2>/dev/null || true
  )"

  token="$(printf '%s' "$token" | tr -d '\r')"
  if [[ -z "$token" ]]; then
    echo "[lifecycle][warn] Runtime admin token not found in ${REMOTE_ENV_PATH}; dispatch-ready polling will fall back."
    return 1
  fi

  RUNTIME_ADMIN_TOKEN="$token"
  return 0
}

clear_driver_lock_if_possible() {
  if [[ -z "$RUNTIME_ADMIN_TOKEN" ]]; then
    return 1
  fi

  local response_file="$ARTIFACTS_DIR/_driver_status/clear-lock.json"
  mkdir -p "$(dirname "$response_file")"
  if curl -fsS --max-time 20 \
    -X POST \
    "${API_BASE_URL}/api/driver-status/${DRIVER_UID}/clear-lock?token=${RUNTIME_ADMIN_TOKEN}" \
    > "$response_file"; then
    return 0
  fi

  return 1
}

probe_driver_dispatch_ready_via_ssh() {
  if [[ -z "$REMOTE_HOST" ]] || [[ ! -f "$REMOTE_KEY" ]] || ! have_cmd ssh; then
    return 1
  fi

  ssh -i "$REMOTE_KEY" -o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout=8 "root@${REMOTE_HOST}" \
    "docker exec -i -e TEST_DRIVER_UID='${DRIVER_UID}' leaf-websocket node - <<'NODE'
const redisPool = require('./utils/redis-pool');
(async () => {
  await redisPool.ensureConnection();
  const redis = redisPool.getConnection();
  const driverId = process.env.TEST_DRIVER_UID;
  const [isOnline, isEligible, lockRaw, activeNotification, activeTrip, activeTripCustomer, driverHash] = await Promise.all([
    redis.zscore('driver_locations', driverId),
    redis.zscore('driver_locations_eligible', driverId),
    redis.get('driver_lock:' + driverId),
    redis.get('driver_active_notification:' + driverId),
    redis.get('active_trip_by_driver:' + driverId),
    redis.get('active_trip_customer_by_driver:' + driverId),
    redis.hgetall('driver:' + driverId),
  ]);

  console.log('__READY__' + JSON.stringify({
    driverId,
    isOnlineInRedis: isOnline !== null,
    isEligibleInGeo: isEligible !== null,
    hasLock: Boolean(lockRaw),
    lockRaw,
    activeNotification,
    activeTrip,
    activeTripCustomer,
    dispatchEligible: String(driverHash?.dispatchEligible || '').toLowerCase() === 'true',
    driverHash,
  }));
  process.exit(0);
})().catch((error) => {
  console.error('__READY_ERROR__' + (error?.message || error));
  process.exit(1);
});
NODE" 2>/dev/null | grep '^__READY__' | tail -n 1
}

can_probe_backend_ssh() {
  if [[ -z "$REMOTE_HOST" ]] || [[ ! -f "$REMOTE_KEY" ]] || ! have_cmd ssh; then
    return 1
  fi

  run_with_timeout 6 \
    ssh -i "$REMOTE_KEY" -o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout=4 \
      "root@${REMOTE_HOST}" "exit 0" >/dev/null 2>&1
}

clear_driver_lock_via_ssh() {
  if [[ -z "$REMOTE_HOST" ]] || [[ ! -f "$REMOTE_KEY" ]] || ! have_cmd ssh; then
    return 1
  fi

  ssh -i "$REMOTE_KEY" -o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout=8 "root@${REMOTE_HOST}" \
    "docker exec -i -e TEST_DRIVER_UID='${DRIVER_UID}' leaf-websocket node - <<'NODE'
const redisPool = require('./utils/redis-pool');
(async () => {
  await redisPool.ensureConnection();
  const redis = redisPool.getConnection();
  const driverId = process.env.TEST_DRIVER_UID;
  const deleted = await redis.del('driver_lock:' + driverId, 'driver_active_notification:' + driverId);
  console.log('__CLEARED__' + deleted);
  process.exit(0);
})().catch((error) => {
  console.error('__CLEAR_ERROR__' + (error?.message || error));
  process.exit(1);
});
NODE" >/dev/null 2>&1
}

isolate_other_test_drivers_via_ssh() {
  if [[ -z "$REMOTE_HOST" ]] || [[ ! -f "$REMOTE_KEY" ]] || ! have_cmd ssh || [[ -z "$OTHER_DRIVER_UIDS" ]]; then
    return 1
  fi

  ssh -i "$REMOTE_KEY" -o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout=8 "root@${REMOTE_HOST}" \
    "docker exec -i -e OTHER_DRIVER_UIDS='${OTHER_DRIVER_UIDS}' leaf-websocket node - <<'NODE'
const redisPool = require('./utils/redis-pool');
(async () => {
  await redisPool.ensureConnection();
  const redis = redisPool.getConnection();
  const raw = String(process.env.OTHER_DRIVER_UIDS || '');
  const driverIds = raw.split(',').map((value) => value.trim()).filter(Boolean);

  for (const driverId of driverIds) {
    await redis.zrem('driver_locations', driverId);
    await redis.zrem('driver_locations_eligible', driverId);
    await redis.zrem('driver_offline_locations', driverId);
    await redis.del(
      'driver_lock:' + driverId,
      'driver_active_notification:' + driverId,
      'active_trip_by_driver:' + driverId,
      'active_trip_customer_by_driver:' + driverId,
    );
    await redis.hset('driver:' + driverId, {
      isOnline: 'false',
      status: 'OFFLINE',
      dispatchEligible: 'false',
      dispatchEligibilityCode: 'QA_ISOLATED',
      dispatchEligibilityCheckedAt: new Date().toISOString(),
    });
  }

  console.log('__ISOLATED__' + JSON.stringify({ count: driverIds.length, driverIds }));
  process.exit(0);
})().catch((error) => {
  console.error('__ISOLATE_ERROR__' + (error?.message || error));
  process.exit(1);
});
NODE" 2>/dev/null | grep '^__ISOLATED__' | tail -n 1
}

wait_for_driver_dispatch_ready() {
  local timeout_seconds="${1:-75}"
  local started_at
  local attempt=0
  local driver_status_file="$ARTIFACTS_DIR/_driver_status/driver-status-latest.json"
  mkdir -p "$(dirname "$driver_status_file")"
  started_at="$(date +%s)"

  if ! load_runtime_admin_token; then
    if ! can_probe_backend_ssh; then
      echo "[lifecycle][warn] Backend ssh unavailable; falling back immediately to online-only readiness."
      wait_for_driver_online "$timeout_seconds"
      return $?
    fi

    echo "[lifecycle][warn] Runtime token unavailable; trying dispatch-ready probe via backend ssh."
    while true; do
      attempt=$((attempt + 1))
      local ready_line=""
      local ready_json=""
      local is_online_redis="false"
      local eligible_geo="false"
      local has_lock="false"
      local active_trip=""
      local dispatch_eligible="false"

      ready_line="$(probe_driver_dispatch_ready_via_ssh || true)"
      ready_json="${ready_line#__READY__}"
      if [[ -n "$ready_json" && "$ready_json" != "$ready_line" ]]; then
        printf '%s\n' "$ready_json" > "$driver_status_file"
        is_online_redis="$(jq -r '.isOnlineInRedis // false' "$driver_status_file" 2>/dev/null || echo false)"
        eligible_geo="$(jq -r '.isEligibleInGeo // false' "$driver_status_file" 2>/dev/null || echo false)"
        has_lock="$(jq -r '.hasLock // false' "$driver_status_file" 2>/dev/null || echo false)"
        active_trip="$(jq -r '.activeTrip // empty' "$driver_status_file" 2>/dev/null || echo "")"
        dispatch_eligible="$(jq -r '.dispatchEligible // false' "$driver_status_file" 2>/dev/null || echo false)"
        if [[ "$has_lock" == "true" && -z "$active_trip" ]]; then
          echo "[lifecycle][warn] Residual driver lock found via backend ssh; clearing."
          clear_driver_lock_via_ssh || true
        fi
        if [[ "$is_online_redis" == "true" && "$eligible_geo" == "true" && "$dispatch_eligible" == "true" && "$has_lock" != "true" && -z "$active_trip" ]]; then
          echo "[lifecycle] driver dispatch-ready via backend ssh after attempt ${attempt}"
          return 0
        fi
      fi

      if (( $(date +%s) - started_at >= timeout_seconds )); then
        echo "[lifecycle][warn] Backend ssh probe did not reach dispatch-ready; falling back to online-only readiness."
        wait_for_driver_online "$timeout_seconds"
        return $?
      fi

      sleep 2
    done
  fi

  clear_driver_lock_if_possible >/dev/null 2>&1 || true

  while true; do
    attempt=$((attempt + 1))
    local can_receive="false"
    local eligible_geo="false"
    local is_online_redis="false"
    local is_authenticated="false"
    local is_locked="false"
    local current_lock_booking=""

    if curl -fsS --max-time 15 \
      "${API_BASE_URL}/api/driver-status/${DRIVER_UID}?token=${RUNTIME_ADMIN_TOKEN}" \
      > "$driver_status_file"; then
      can_receive="$(jq -r '.canReceiveRequests // false' "$driver_status_file" 2>/dev/null || echo false)"
      eligible_geo="$(jq -r '.details.isEligibleInGeo // false' "$driver_status_file" 2>/dev/null || echo false)"
      is_online_redis="$(jq -r '.details.isOnlineInRedis // false' "$driver_status_file" 2>/dev/null || echo false)"
      is_authenticated="$(jq -r '.details.isAuthenticated // false' "$driver_status_file" 2>/dev/null || echo false)"
      is_locked="$(jq -r '.details.isLocked // false' "$driver_status_file" 2>/dev/null || echo false)"
      current_lock_booking="$(jq -r '.details.currentLock.bookingId // empty' "$driver_status_file" 2>/dev/null || echo "")"
      if [[ "$can_receive" == "true" && "$eligible_geo" == "true" ]]; then
        echo "[lifecycle] driver dispatch-ready after attempt ${attempt} (redis=${is_online_redis}, socket=${is_authenticated})"
        return 0
      fi

      if [[ "$is_locked" == "true" ]]; then
        echo "[lifecycle][warn] Driver lock still present for booking ${current_lock_booking:-unknown}; retrying clear-lock."
        clear_driver_lock_if_possible >/dev/null 2>&1 || true
      fi
    fi

    if (( $(date +%s) - started_at >= timeout_seconds )); then
      echo "[lifecycle][error] Driver never became dispatch-ready in ${timeout_seconds}s"
      if [[ -f "$driver_status_file" ]]; then
        cat "$driver_status_file"
      fi
      return 1
    fi

    sleep 2
  done
}

wait_for_passenger_idle() {
  local timeout_seconds="${1:-60}"
  local started_at
  local stable_idle_samples=0
  started_at="$(date +%s)"

  while true; do
    local booking_status=""
    local active_booking_id=""

    booking_status="$(read_runtime_field "$PASSENGER_UDID" "bookingStatus")"
    active_booking_id="$(read_runtime_field "$PASSENGER_UDID" "activeBookingId")"

    if [[ "$booking_status" == "idle" && "$active_booking_id" == "null" ]]; then
      stable_idle_samples=$((stable_idle_samples + 1))
      if (( stable_idle_samples >= 2 )); then
        return 0
      fi
    else
      stable_idle_samples=0
    fi

    if (( $(date +%s) - started_at >= timeout_seconds )); then
      echo "[lifecycle][error] Passenger did not stabilize idle in ${timeout_seconds}s (status=${booking_status:-unknown}, activeBookingId=${active_booking_id:-unknown})"
      return 1
    fi

    sleep 2
  done
}

seed_sim_auth() {
  local udid="$1"
  local role="$2"
  local -a args=(
    "$SEED_AUTH_SCRIPT"
    --udid "$udid"
    --app-id "$APP_ID"
    --role "$role"
  )

  if [[ "$role" == "customer" && -n "$PASSENGER_PROFILE_KEY" ]]; then
    args+=(--profile-key "$PASSENGER_PROFILE_KEY")
  elif [[ "$role" == "driver" && -n "$DRIVER_PROFILE_KEY" ]]; then
    args+=(--profile-key "$DRIVER_PROFILE_KEY")
  fi

  node "${args[@]}"
}

seed_runtime_state() {
  local udid="$1"
  local scenario="$2"
  local freeze_ms="${3:-30000}"
  local artifact_dir="$ARTIFACTS_DIR/_state_seed/${scenario}-${udid}"

  case "$scenario" in
    driver-home|passenger-home)
      if [[ -z "${3:-}" ]]; then
        freeze_ms="0"
      fi
      ;;
  esac

  mkdir -p "$artifact_dir"
  local -a args=(
    "$SEED_PROTOTYPE_STATE_SCRIPT"
    --device "$udid"
    --scenario "$scenario"
    --artifact-dir "$artifact_dir"
    --freeze-ms "$freeze_ms"
  )

  if [[ "$scenario" == "passenger-home" && -n "$PASSENGER_RUNTIME_UID" ]]; then
    args+=(--uid "$PASSENGER_RUNTIME_UID")
  elif [[ "$scenario" == "driver-home" && -n "$DRIVER_RUNTIME_UID" ]]; then
    args+=(--uid "$DRIVER_RUNTIME_UID")
  fi

  if [[ "$scenario" == "passenger-home" && -n "$PASSENGER_CURRENT_LAT" && -n "$PASSENGER_CURRENT_LNG" ]]; then
    args+=(--current-lat "$PASSENGER_CURRENT_LAT" --current-lng "$PASSENGER_CURRENT_LNG")
    if [[ -n "$PASSENGER_CURRENT_ADDRESS" ]]; then
      args+=(--current-address "$PASSENGER_CURRENT_ADDRESS")
    fi
  elif [[ "$scenario" == "driver-home" && -n "$DRIVER_CURRENT_LAT" && -n "$DRIVER_CURRENT_LNG" ]]; then
    args+=(--current-lat "$DRIVER_CURRENT_LAT" --current-lng "$DRIVER_CURRENT_LNG")
    if [[ -n "$DRIVER_CURRENT_ADDRESS" ]]; then
      args+=(--current-address "$DRIVER_CURRENT_ADDRESS")
    fi
  fi

  node "${args[@]}" >/dev/null

  if [[ "$USE_DEV_CLIENT_DEEPLINK" == "true" ]]; then
    touch "$(dev_client_marker_path "$udid")"
  fi
}

grant_location_permissions() {
  local udid="$1"
  run_with_timeout 10 xcrun simctl privacy "$udid" grant location "$APP_ID" >/dev/null 2>&1 || true
  run_with_timeout 10 xcrun simctl privacy "$udid" grant location-always "$APP_ID" >/dev/null 2>&1 || true
}

set_device_location() {
  local udid="$1"
  local latitude="$2"
  local longitude="$3"
  run_with_timeout 15 xcrun simctl location "$udid" set "${latitude},${longitude}" >/dev/null 2>&1 || true
}

suppress_dev_client_onboarding() {
  local udid="$1"
  xcrun simctl spawn "$udid" defaults write "$APP_ID" EXDevMenuIsOnboardingFinished -bool YES >/dev/null 2>&1 || true
  xcrun simctl spawn "$udid" defaults write "$APP_ID" EXDevMenuShowsAtLaunch -bool NO >/dev/null 2>&1 || true
}

reinstall_and_seed_apps() {
  for udid in "$PASSENGER_UDID" "$DRIVER_UDID"; do
    echo "[lifecycle] reinstalling app on ${udid}"
    rm -f "$(dev_client_marker_path "$udid")"
    run_with_timeout "$SIMCTL_TERMINATE_TIMEOUT_SECONDS" xcrun simctl terminate "$udid" "$APP_ID" >/dev/null 2>&1 || true
    run_with_timeout "$SIMCTL_UNINSTALL_TIMEOUT_SECONDS" xcrun simctl uninstall "$udid" "$APP_ID" >/dev/null 2>&1 || true
    run_with_timeout "$SIMCTL_INSTALL_TIMEOUT_SECONDS" xcrun simctl install "$udid" "$APP_PATH"
    suppress_dev_client_onboarding "$udid"
  done

  grant_location_permissions "$PASSENGER_UDID"
  grant_location_permissions "$DRIVER_UDID"
  if [[ -n "$PASSENGER_CURRENT_LAT" && -n "$PASSENGER_CURRENT_LNG" ]]; then
    set_device_location "$PASSENGER_UDID" "$PASSENGER_CURRENT_LAT" "$PASSENGER_CURRENT_LNG"
  fi
  if [[ -n "$DRIVER_CURRENT_LAT" && -n "$DRIVER_CURRENT_LNG" ]]; then
    set_device_location "$DRIVER_UDID" "$DRIVER_CURRENT_LAT" "$DRIVER_CURRENT_LNG"
  fi
  seed_sim_auth "$PASSENGER_UDID" customer
  seed_sim_auth "$DRIVER_UDID" driver

  foreground_app "$PASSENGER_UDID" "$FLOW_SETTLE_SECONDS"
  foreground_app "$DRIVER_UDID" "$FLOW_SETTLE_SECONDS"

  seed_sim_auth "$PASSENGER_UDID" customer
  seed_sim_auth "$DRIVER_UDID" driver

  run_with_timeout 10 xcrun simctl terminate "$PASSENGER_UDID" "$APP_ID" >/dev/null 2>&1 || true
  run_with_timeout 10 xcrun simctl terminate "$DRIVER_UDID" "$APP_ID" >/dev/null 2>&1 || true
  rm -f "$(dev_client_marker_path "$PASSENGER_UDID")" "$(dev_client_marker_path "$DRIVER_UDID")"
}

foreground_app() {
  local udid="$1"
  local settle_seconds="${2:-$FLOW_SETTLE_SECONDS}"
  local launch_artifacts_dir="$ARTIFACTS_DIR/_launch_watch/${udid}"
  local dev_client_marker
  mkdir -p "$launch_artifacts_dir"
  run_with_timeout $((settle_seconds + 15)) \
    bash "$GUARDED_IOS_LAUNCH_SCRIPT" "$udid" "$APP_ID" "$settle_seconds" "$launch_artifacts_dir" >/dev/null

  if [[ "$USE_DEV_CLIENT_DEEPLINK" == "true" ]]; then
    dev_client_marker="$(dev_client_marker_path "$udid")"
    if [[ ! -f "$dev_client_marker" ]]; then
      run_with_timeout 10 xcrun simctl openurl "$udid" "$DEV_CLIENT_DEEPLINK" >/dev/null
      run_with_timeout 20 maestro test "$ACCEPT_OPEN_PROMPT_FLOW" \
        --udid "$udid" \
        --no-reinstall-driver \
        --test-output-dir "$ARTIFACTS_DIR/dev-client-open-${udid}" >/dev/null || true
      sleep "$settle_seconds"
      touch "$dev_client_marker"
    fi
  fi
}

run_flow() {
  local udid="$1"
  local flow="$2"
  local name="$3"
  local reuse_running_app="${4:-false}"
  echo "[lifecycle] running ${name}"
  cleanup_maestro_processes
  if [[ "$reuse_running_app" != "true" ]]; then
    foreground_app "$udid" "$FLOW_SETTLE_SECONDS"
  fi
  maestro test "$flow" \
    --udid "$udid" \
    --no-reinstall-driver \
    --test-output-dir "$ARTIFACTS_DIR/${name}"
}

run_driver_action() {
  local action="$1"
  local nonce="$2"
  local name="$3"
  local reuse_running_app="${4:-false}"
  echo "[lifecycle] running ${name}"
  if [[ "$reuse_running_app" != "true" ]]; then
    foreground_app "$DRIVER_UDID" "$FLOW_SETTLE_SECONDS"
  fi
  node "$QUEUE_HOME_AUTOMATION_SCRIPT" \
    --udid "$DRIVER_UDID" \
    --app-id "$APP_ID" \
    --role driver \
    --action "$action" \
    --nonce "$nonce"
  run_with_timeout 10 \
    xcrun simctl openurl "$DRIVER_UDID" \
    "leafapp://robotaxi/home?qaAutomation=1&qaDriverAction=${action}&qaNonce=${nonce}" >/dev/null 2>&1 || true
  sleep "$FLOW_SETTLE_SECONDS"
}

wait_for_driver_booking_status() {
  local expected_status="$1"
  local timeout_seconds="${2:-60}"
  local started_at
  started_at="$(date +%s)"

  while true; do
    local booking_status=""
    booking_status="$(read_runtime_field "$DRIVER_UDID" "bookingStatus")"

    if [[ "$booking_status" == "$expected_status" ]]; then
      return 0
    fi

    if (( $(date +%s) - started_at >= timeout_seconds )); then
      echo "[lifecycle][error] Driver did not reach status ${expected_status} in ${timeout_seconds}s (status=${booking_status:-unknown})"
      return 1
    fi

    sleep 2
  done
}

wait_for_driver_completion() {
  local expected_booking_id="$1"
  local timeout_seconds="${2:-60}"
  local started_at
  started_at="$(date +%s)"

  while true; do
    local booking_status=""
    local runtime_snapshot=""
    local last_receipt_id=""

    booking_status="$(read_runtime_field "$DRIVER_UDID" "bookingStatus")"
    if [[ "$booking_status" == "completed" ]]; then
      return 0
    fi

    runtime_snapshot="$(read_runtime_snapshot "$DRIVER_UDID")"
    if [[ -n "$runtime_snapshot" ]]; then
      last_receipt_id="$(
        printf '%s' "$runtime_snapshot" | jq -r '.lastReceipt.id // empty' 2>/dev/null || true
      )"
      if [[ "$booking_status" == "idle" && -n "$last_receipt_id" && "$last_receipt_id" == "$expected_booking_id" ]]; then
        return 0
      fi
    fi

    if (( $(date +%s) - started_at >= timeout_seconds )); then
      echo "[lifecycle][error] Driver did not settle completed in ${timeout_seconds}s (status=${booking_status:-unknown}, lastReceiptId=${last_receipt_id:-none}, expectedBookingId=${expected_booking_id:-none})"
      return 1
    fi

    sleep 2
  done
}

run_passenger_action() {
  local action="$1"
  local nonce="$2"
  local name="$3"
  echo "[lifecycle] running ${name}"
  foreground_app "$PASSENGER_UDID" "$FLOW_SETTLE_SECONDS"
  node "$QUEUE_HOME_AUTOMATION_SCRIPT" \
    --udid "$PASSENGER_UDID" \
    --app-id "$APP_ID" \
    --role customer \
    --action "$action" \
    --nonce "$nonce"
  run_with_timeout 10 \
    xcrun simctl openurl "$PASSENGER_UDID" \
    "leafapp://robotaxi/home?qaAutomation=1&qaPassengerAction=${action}&qaNonce=${nonce}" >/dev/null 2>&1 || true
  sleep "$FLOW_SETTLE_SECONDS"
}

run_passenger_request() {
  local nonce="$1"
  local name="$2"
  echo "[lifecycle] running ${name}"
  foreground_app "$PASSENGER_UDID" "$FLOW_SETTLE_SECONDS"
  run_with_timeout 10 \
    xcrun simctl openurl "$PASSENGER_UDID" \
    "leafapp://robotaxi/destination?qaAutomation=1&qaAutoFlow=request&qaPresetQuery=Copacabana%20Palace&qaNonce=${nonce}" >/dev/null 2>&1 || true
  sleep "$FLOW_SETTLE_SECONDS"
}

wait_for_passenger_booking_created() {
  local timeout_seconds="${1:-90}"
  local started_at
  started_at="$(date +%s)"

  while true; do
    local booking_status=""
    local active_booking_id=""

    booking_status="$(read_runtime_field "$PASSENGER_UDID" "bookingStatus")"
    active_booking_id="$(read_runtime_field "$PASSENGER_UDID" "activeBookingId")"

    if [[ -n "$active_booking_id" && "$active_booking_id" != "null" ]]; then
      printf '%s\n' "$active_booking_id"
      return 0
    fi

    if (( $(date +%s) - started_at >= timeout_seconds )); then
      echo "[lifecycle][error] Passenger did not create booking in ${timeout_seconds}s (status=${booking_status:-unknown}, activeBookingId=${active_booking_id:-unknown})"
      return 1
    fi

    sleep 2
  done
}

capture_device() {
  local udid="$1"
  local output="$2"
  xcrun simctl io "$udid" screenshot "$output" >/dev/null
}

capture_pair_after_stabilization() {
  local slug="$1"
  echo "[lifecycle] waiting ${STABILIZATION_SECONDS}s before screenshots for ${slug}"
  sleep "$STABILIZATION_SECONDS"
  capture_device "$PASSENGER_UDID" "$ARTIFACTS_DIR/${slug}-passenger.png"
  capture_device "$DRIVER_UDID" "$ARTIFACTS_DIR/${slug}-driver.png"
}

cd "$MOBILE_DIR"

ensure_simulator_window
boot_device "$PASSENGER_UDID"
boot_device "$DRIVER_UDID"
reinstall_and_seed_apps

echo "[lifecycle] foregrounding both devices before scenario start"
foreground_app "$PASSENGER_UDID" "$FLOW_SETTLE_SECONDS"
foreground_app "$DRIVER_UDID" "$FLOW_SETTLE_SECONDS"

run_passenger_action "cleanup_active" "bootstrap-cleanup" "00-passenger-cleanup"
wait_for_passenger_idle 60

if isolated_driver_result="$(isolate_other_test_drivers_via_ssh || true)"; then
  if [[ -n "$isolated_driver_result" ]]; then
    echo "[lifecycle] isolated competing QA drivers ${OTHER_DRIVER_UIDS}"
  fi
fi

seed_runtime_state "$DRIVER_UDID" "driver-home"
run_driver_action "set_online" "bootstrap-online" "01-driver-online"
wait_for_driver_online 60
wait_for_driver_dispatch_ready "$DISPATCH_READY_TIMEOUT_SECONDS"

seed_runtime_state "$PASSENGER_UDID" "passenger-home"
run_passenger_request "step02" "02-passenger-request"
wait_for_passenger_booking_created 90 >/dev/null
capture_pair_after_stabilization "02-passenger-request"

run_driver_action "accept_offer" "step03" "03-driver-accept" "true"
wait_for_driver_booking_status "accepted" 60
capture_pair_after_stabilization "03-driver-accept"

run_driver_action "arrive_pickup" "step04" "04-driver-arrived" "true"
wait_for_driver_booking_status "arrived" 60
capture_pair_after_stabilization "04-driver-arrived"

run_driver_action "start_trip" "step05" "05-driver-start" "true"
wait_for_driver_booking_status "started" 60
capture_pair_after_stabilization "05-driver-start"

driver_completion_booking_id="$(read_runtime_field "$DRIVER_UDID" "activeBookingId")"
run_driver_action "complete_trip" "step06" "06-driver-complete" "true"
wait_for_driver_completion "$driver_completion_booking_id" 60
capture_pair_after_stabilization "06-driver-complete"

cat <<EOF
[lifecycle] done
[lifecycle] artifacts: $ARTIFACTS_DIR
EOF
