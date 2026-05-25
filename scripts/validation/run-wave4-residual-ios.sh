#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

LABEL="wave4-residual-ios"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --label)
      LABEL="$2"
      shift 2
      ;;
    *)
      echo "usage: $0 [--label <label>]" >&2
      exit 1
      ;;
  esac
done

ensure_run_dir "$LABEL"
require_cmd xcrun
require_cmd maestro
require_cmd node

PASSENGER_UDID="${PASSENGER_UDID:-195D2C57-87DC-4953-ABF1-4FD351ADBBEF}"
DRIVER_UDID="${DRIVER_UDID:-2E44BC8E-9AA8-43BE-BD5E-D0B5A73E543C}"
APP_ID="${APP_ID:-br.com.leaf.ride}"
APP_PATH="${APP_PATH:-${ROOT_DIR}/mobile-app/ios/build/Build/Products/Release-iphonesimulator/Leaf.app}"
STABILIZATION_SECONDS="${STABILIZATION_SECONDS:-15}"
FLOW_SETTLE_SECONDS="${FLOW_SETTLE_SECONDS:-6}"
ARTIFACT_DIR="${RUN_DIR}/wave4/residual-ios-$(timestamp_now)"
mkdir -p "$ARTIFACT_DIR"

FLOW_DIR="${ROOT_DIR}/mobile-app/.maestro/flows/qa/e2e/wave4"
LIFECYCLE_DIR="${ROOT_DIR}/mobile-app/.maestro/flows/qa/e2e/lifecycle"
SEED_AUTH_SCRIPT="${ROOT_DIR}/scripts/validation/lib/seed-sim-auth.cjs"
GUARDED_IOS_LAUNCH_SCRIPT="${ROOT_DIR}/scripts/validation/lib/guarded-ios-launch.sh"

foreground_app() {
  local udid="$1"
  local launch_artifacts_dir="$ARTIFACT_DIR/_launch_watch/${udid}"
  mkdir -p "$launch_artifacts_dir"
  bash "$GUARDED_IOS_LAUNCH_SCRIPT" "$udid" "$APP_ID" "$FLOW_SETTLE_SECONDS" "$launch_artifacts_dir" >/dev/null
}

open_url() {
  local udid="$1"
  local url="$2"
  xcrun simctl openurl "$udid" "$url"
}

capture_device() {
  local udid="$1"
  local output="$2"
  xcrun simctl io "$udid" screenshot "$output" >/dev/null
}

wait_and_capture_pair() {
  local slug="$1"
  log "waiting ${STABILIZATION_SECONDS}s before screenshots for ${slug}"
  sleep "$STABILIZATION_SECONDS"
  capture_device "$PASSENGER_UDID" "$ARTIFACT_DIR/${slug}-passenger.png"
  capture_device "$DRIVER_UDID" "$ARTIFACT_DIR/${slug}-driver.png"
}

run_flow() {
  local udid="$1"
  local flow="$2"
  local slug="$3"
  log "running flow ${slug}"
  foreground_app "$udid"
  maestro test "$flow" \
    --udid "$udid" \
    --no-reinstall-driver \
    --test-output-dir "$ARTIFACT_DIR/maestro-${slug}" >/dev/null
}

run_driver_action() {
  local action="$1"
  local nonce="$2"
  foreground_app "$DRIVER_UDID"
  open_url "$DRIVER_UDID" "leafapp://robotaxi/home?qaAutomation=1&qaDriverAction=${action}&qaNonce=${nonce}"
  sleep "$FLOW_SETTLE_SECONDS"
}

seed_sim_auth() {
  local udid="$1"
  local role="$2"
  node "$SEED_AUTH_SCRIPT" --udid "$udid" --app-id "$APP_ID" --role "$role"
}

grant_location_permissions() {
  local udid="$1"
  xcrun simctl terminate "$udid" "$APP_ID" >/dev/null 2>&1 || true
  xcrun simctl privacy "$udid" grant location "$APP_ID" >/dev/null 2>&1 || true
  xcrun simctl privacy "$udid" grant location-always "$APP_ID" >/dev/null 2>&1 || true
}

cleanup_active_ride_if_needed() {
  log "frontend cleanup of any dangling ride before scenario"
  foreground_app "$DRIVER_UDID"
  open_url "$DRIVER_UDID" "leafapp://robotaxi/home?qaAutomation=1&qaDriverAction=accept_offer&qaNonce=residual-cleanup-accept"
  sleep 3
  open_url "$DRIVER_UDID" "leafapp://robotaxi/home?qaAutomation=1&qaDriverAction=arrive_pickup&qaNonce=residual-cleanup-arrive"
  sleep 3
  open_url "$DRIVER_UDID" "leafapp://robotaxi/home?qaAutomation=1&qaDriverAction=start_trip&qaNonce=residual-cleanup-start"
  sleep 3
  open_url "$DRIVER_UDID" "leafapp://robotaxi/home?qaAutomation=1&qaDriverAction=complete_trip&qaNonce=residual-cleanup-complete"
  sleep 6
}

reinstall_apps() {
  log "reinstalling current build"
  xcrun simctl terminate "$PASSENGER_UDID" "$APP_ID" >/dev/null 2>&1 || true
  xcrun simctl terminate "$DRIVER_UDID" "$APP_ID" >/dev/null 2>&1 || true
  xcrun simctl uninstall "$PASSENGER_UDID" "$APP_ID" >/dev/null 2>&1 || true
  xcrun simctl uninstall "$DRIVER_UDID" "$APP_ID" >/dev/null 2>&1 || true
  xcrun simctl install "$PASSENGER_UDID" "$APP_PATH"
  xcrun simctl install "$DRIVER_UDID" "$APP_PATH"
  grant_location_permissions "$PASSENGER_UDID"
  grant_location_permissions "$DRIVER_UDID"
  seed_sim_auth "$PASSENGER_UDID" customer
  seed_sim_auth "$DRIVER_UDID" driver
  foreground_app "$PASSENGER_UDID"
  foreground_app "$DRIVER_UDID"
  seed_sim_auth "$PASSENGER_UDID" customer
  seed_sim_auth "$DRIVER_UDID" driver
  xcrun simctl terminate "$PASSENGER_UDID" "$APP_ID" >/dev/null 2>&1 || true
  xcrun simctl terminate "$DRIVER_UDID" "$APP_ID" >/dev/null 2>&1 || true
  foreground_app "$PASSENGER_UDID"
  foreground_app "$DRIVER_UDID"
}

prepare_clean_scenario() {
  cleanup_active_ride_if_needed
  reinstall_apps
}

start_real_trip() {
  run_driver_action set_online "real-trip-online"
  run_flow "$PASSENGER_UDID" "$LIFECYCLE_DIR/02-passenger-request-home.yaml" "request-home"
  run_driver_action accept_offer "real-trip-accept"
  foreground_app "$PASSENGER_UDID"
  sleep "$STABILIZATION_SECONDS"
  run_driver_action arrive_pickup "real-trip-arrive"
  foreground_app "$PASSENGER_UDID"
  sleep "$STABILIZATION_SECONDS"
  run_driver_action start_trip "real-trip-start"
  foreground_app "$PASSENGER_UDID"
  sleep "$STABILIZATION_SECONDS"
  foreground_app "$DRIVER_UDID"
}

if [[ ! -d "$APP_PATH" ]]; then
  echo "[validation][error] app not found: $APP_PATH" >&2
  exit 1
fi

log "scenario W4-DISP-002: late eligible driver during open search"
prepare_clean_scenario
run_driver_action set_online "disp-online-before-quote"
run_flow "$PASSENGER_UDID" "$FLOW_DIR/00-passenger-quote-ready.yaml" "disp-quote-ready"
run_driver_action set_offline "disp-offline-before-request"
run_flow "$PASSENGER_UDID" "$FLOW_DIR/01-passenger-request-from-quote.yaml" "disp-request-from-quote"
wait_and_capture_pair "01-late-eligible-search-open"
run_driver_action set_online "disp-online-late"
wait_and_capture_pair "01-late-eligible-offer-15s"
sleep "$STABILIZATION_SECONDS"
capture_device "$PASSENGER_UDID" "$ARTIFACT_DIR/01-late-eligible-offer-30s-passenger.png"
capture_device "$DRIVER_UDID" "$ARTIFACT_DIR/01-late-eligible-offer-30s-driver.png"

log "scenario W4-OPS-001: passenger cancels before acceptance"
prepare_clean_scenario
run_driver_action set_online "ops-cancel-online"
run_flow "$PASSENGER_UDID" "$LIFECYCLE_DIR/02-passenger-request-home.yaml" "ops-cancel-request"
wait_and_capture_pair "02-cancel-search-baseline"
run_flow "$PASSENGER_UDID" "$FLOW_DIR/02-passenger-cancel-search.yaml" "ops-cancel-search"
wait_and_capture_pair "02-cancel-search-result"

log "scenario W4-OPS-001/W4-OPS-002: operational interruption and reassignment"
prepare_clean_scenario
start_real_trip
wait_and_capture_pair "03-operational-started"
run_driver_action interrupt_operational "ops-driver-interrupt"
wait_and_capture_pair "03-operational-interrupted"
wait_and_capture_pair "03-operational-reassignment-search"

log "scenario W4-OPS-002: early termination during started"
prepare_clean_scenario
start_real_trip
wait_and_capture_pair "04-end-early-started"
run_flow "$PASSENGER_UDID" "$FLOW_DIR/05-passenger-end-early.yaml" "ops-passenger-end-early"
wait_and_capture_pair "04-end-early-result"

log "scenario W4-OPS-002: extension request surfaced on both sides"
prepare_clean_scenario
start_real_trip
wait_and_capture_pair "05-extension-started"
open_url "$PASSENGER_UDID" "leafapp://robotaxi/destination?mode=extension&returnRouteName=RobotaxiPrototypeTrip&qaAutomation=1&qaAutoFlow=extension&qaAutoSelectFirst=1&qaPresetQuery=Stanford"
sleep "$FLOW_SETTLE_SECONDS"
run_flow "$PASSENGER_UDID" "$FLOW_DIR/06-passenger-request-extension.yaml" "ops-passenger-extension-request"
wait_and_capture_pair "05-extension-requested"
run_driver_action accept_extension "ops-driver-extension-accept"
wait_and_capture_pair "05-extension-accepted"

SUMMARY_PATH="${ARTIFACT_DIR}/summary.md"
write_summary_file "$SUMMARY_PATH" "# Wave 4 Residual iOS Validation\n\n- Run dir: ${RUN_DIR}\n- Artifact dir: ${ARTIFACT_DIR}\n- Coverage: late eligible, cancel before acceptance, operational interruption, reassignment search, early termination, extension request/driver acceptance\n- Rule: 15s before every screenshot\n"

log "wave4 residual validation finished"
log "artifacts: ${ARTIFACT_DIR}"
