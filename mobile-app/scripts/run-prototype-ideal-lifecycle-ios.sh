#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MOBILE_DIR="$ROOT_DIR/mobile-app"

PASSENGER_UDID="${PASSENGER_UDID:-195D2C57-87DC-4953-ABF1-4FD351ADBBEF}"
DRIVER_UDID="${DRIVER_UDID:-2E44BC8E-9AA8-43BE-BD5E-D0B5A73E543C}"
APP_ID="${APP_ID:-br.com.leaf.ride}"
APP_PATH="${APP_PATH:-}"
RELEASE_APP_PATH="$ROOT_DIR/mobile-app/ios/build/Build/Products/Release-iphonesimulator/Leaf.app"
DEBUG_APP_PATH="$ROOT_DIR/mobile-app/ios/build/Build/Products/Debug-iphonesimulator/Leaf.app"
STABILIZATION_SECONDS="${STABILIZATION_SECONDS:-15}"
FLOW_SETTLE_SECONDS="${FLOW_SETTLE_SECONDS:-8}"
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
  node "$SEED_AUTH_SCRIPT" --udid "$udid" --app-id "$APP_ID" --role "$role"
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
  node "$SEED_PROTOTYPE_STATE_SCRIPT" \
    --device "$udid" \
    --scenario "$scenario" \
    --artifact-dir "$artifact_dir" \
    --freeze-ms "$freeze_ms" >/dev/null

  if [[ "$USE_DEV_CLIENT_DEEPLINK" == "true" ]]; then
    touch "$(dev_client_marker_path "$udid")"
  fi
}

grant_location_permissions() {
  local udid="$1"
  run_with_timeout 10 xcrun simctl privacy "$udid" grant location "$APP_ID" >/dev/null 2>&1 || true
  run_with_timeout 10 xcrun simctl privacy "$udid" grant location-always "$APP_ID" >/dev/null 2>&1 || true
}

suppress_dev_client_onboarding() {
  local udid="$1"
  xcrun simctl spawn "$udid" defaults write "$APP_ID" EXDevMenuIsOnboardingFinished -bool YES >/dev/null 2>&1 || true
  xcrun simctl spawn "$udid" defaults write "$APP_ID" EXDevMenuShowsAtLaunch -bool NO >/dev/null 2>&1 || true
}

reinstall_and_seed_apps() {
  for udid in "$PASSENGER_UDID" "$DRIVER_UDID"; do
    rm -f "$(dev_client_marker_path "$udid")"
    run_with_timeout 10 xcrun simctl terminate "$udid" "$APP_ID" >/dev/null 2>&1 || true
    run_with_timeout 15 xcrun simctl uninstall "$udid" "$APP_ID" >/dev/null 2>&1 || true
    run_with_timeout 30 xcrun simctl install "$udid" "$APP_PATH"
    suppress_dev_client_onboarding "$udid"
  done

  grant_location_permissions "$PASSENGER_UDID"
  grant_location_permissions "$DRIVER_UDID"
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
  echo "[lifecycle] running ${name}"
  cleanup_maestro_processes
  foreground_app "$udid" "$FLOW_SETTLE_SECONDS"
  maestro test "$flow" \
    --udid "$udid" \
    --no-reinstall-driver \
    --test-output-dir "$ARTIFACTS_DIR/${name}"
}

run_driver_action() {
  local action="$1"
  local nonce="$2"
  local name="$3"
  echo "[lifecycle] running ${name}"
  foreground_app "$DRIVER_UDID" "$FLOW_SETTLE_SECONDS"
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

seed_runtime_state "$DRIVER_UDID" "driver-home"
run_driver_action "set_online" "bootstrap-online" "01-driver-online"
wait_for_driver_online 60

seed_runtime_state "$PASSENGER_UDID" "passenger-home"
run_flow "$PASSENGER_UDID" ".maestro/flows/qa/e2e/lifecycle/02-passenger-request-home.yaml" "02-passenger-request"
capture_pair_after_stabilization "02-passenger-request"

run_flow "$DRIVER_UDID" ".maestro/flows/qa/e2e/lifecycle/03-driver-accept-offer.yaml" "03-driver-accept"
capture_pair_after_stabilization "03-driver-accept"

run_flow "$DRIVER_UDID" ".maestro/flows/qa/e2e/lifecycle/04-driver-arrived.yaml" "04-driver-arrived"
capture_pair_after_stabilization "04-driver-arrived"

run_flow "$DRIVER_UDID" ".maestro/flows/qa/e2e/lifecycle/05-driver-start-trip.yaml" "05-driver-start"
capture_pair_after_stabilization "05-driver-start"

run_flow "$DRIVER_UDID" ".maestro/flows/qa/e2e/lifecycle/06-driver-complete-trip.yaml" "06-driver-complete"
capture_pair_after_stabilization "06-driver-complete"

run_flow "$PASSENGER_UDID" ".maestro/flows/qa/e2e/lifecycle/07-passenger-rate-trip.yaml" "07-passenger-rate"
capture_pair_after_stabilization "07-passenger-rate"

cat <<EOF
[lifecycle] done
[lifecycle] artifacts: $ARTIFACTS_DIR
EOF
