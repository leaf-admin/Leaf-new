#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

LABEL="wave4-visual-ios"
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
require_cmd node
require_cmd maestro

PASSENGER_UDID="${PASSENGER_UDID:-195D2C57-87DC-4953-ABF1-4FD351ADBBEF}"
DRIVER_UDID="${DRIVER_UDID:-2E44BC8E-9AA8-43BE-BD5E-D0B5A73E543C}"
APP_ID="${APP_ID:-br.com.leaf.ride}"
APP_PATH="${APP_PATH:-${ROOT_DIR}/mobile-app/ios/build/Build/Products/Release-iphonesimulator/Leaf.app}"
STABILIZATION_SECONDS="${STABILIZATION_SECONDS:-15}"
FLOW_SETTLE_SECONDS="${FLOW_SETTLE_SECONDS:-6}"
RECOVERY_MS="${RECOVERY_MS:-18000}"
METRO_HOST="${METRO_HOST:-127.0.0.1}"
METRO_PORT="${METRO_PORT:-8081}"
ARTIFACT_DIR="${RUN_DIR}/wave4/visual-ios-$(timestamp_now)"
mkdir -p "$ARTIFACT_DIR"
SEED_AUTH_SCRIPT="${ROOT_DIR}/scripts/validation/lib/seed-sim-auth.cjs"
GUARDED_IOS_LAUNCH_SCRIPT="${ROOT_DIR}/scripts/validation/lib/guarded-ios-launch.sh"
ACCEPT_OPEN_PROMPT_FLOW="${ROOT_DIR}/mobile-app/.maestro/flows/qa/_accept-open-prompt.yaml"

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
  printf '%s\n' "$ARTIFACT_DIR/_dev_client_attached_${udid}"
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

suppress_dev_client_onboarding() {
  local udid="$1"
  xcrun simctl spawn "$udid" defaults write "$APP_ID" EXDevMenuIsOnboardingFinished -bool YES >/dev/null 2>&1 || true
  xcrun simctl spawn "$udid" defaults write "$APP_ID" EXDevMenuShowsAtLaunch -bool NO >/dev/null 2>&1 || true
}

foreground_app() {
  local udid="$1"
  local launch_artifacts_dir="$ARTIFACT_DIR/_launch_watch/${udid}"
  local dev_client_marker
  mkdir -p "$launch_artifacts_dir"
  bash "$GUARDED_IOS_LAUNCH_SCRIPT" "$udid" "$APP_ID" "$FLOW_SETTLE_SECONDS" "$launch_artifacts_dir" >/dev/null

  if [[ "$USE_DEV_CLIENT_DEEPLINK" == "true" ]]; then
    dev_client_marker="$(dev_client_marker_path "$udid")"
    if [[ ! -f "$dev_client_marker" ]]; then
      run_with_timeout 10 xcrun simctl openurl "$udid" "$DEV_CLIENT_DEEPLINK" >/dev/null
      run_with_timeout 20 maestro test "$ACCEPT_OPEN_PROMPT_FLOW" \
        --udid "$udid" \
        --no-reinstall-driver \
        --test-output-dir "$ARTIFACT_DIR/dev-client-open-${udid}" >/dev/null || true
      sleep "$FLOW_SETTLE_SECONDS"
      touch "$dev_client_marker"
    fi
  fi
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

wait_and_capture_single() {
  local udid="$1"
  local slug="$2"
  log "waiting ${STABILIZATION_SECONDS}s before screenshot for ${slug}"
  sleep "$STABILIZATION_SECONDS"
  capture_device "$udid" "$ARTIFACT_DIR/${slug}.png"
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

run_passenger_request() {
  local nonce="$1"
  foreground_app "$PASSENGER_UDID"
  open_url "$PASSENGER_UDID" "leafapp://robotaxi/destination?qaAutomation=1&qaAutoFlow=request&qaPresetQuery=Ferry%20Building&qaNonce=${nonce}"
  sleep "$FLOW_SETTLE_SECONDS"
}

run_disconnect_recover() {
  local udid="$1"
  local role="$2"
  local trigger_state="$3"
  local slug="$4"
  foreground_app "$udid"
  open_url "$udid" "leafapp://robotaxi/home?qaAutomation=1&qaConnectionScenario=drop_and_recover&qaConnectionTriggerState=${trigger_state}&qaConnectionRole=${role}&qaConnectionRecoveryMs=${RECOVERY_MS}&qaNonce=${slug}"
}

run_quote_disconnect_recover() {
  local slug="$1"
  foreground_app "$PASSENGER_UDID"
  open_url "$PASSENGER_UDID" "leafapp://robotaxi/destination?qaAutomation=1&qaAutoFlow=quote&qaPresetQuery=Ferry%20Building&qaConnectionScenario=drop_and_recover&qaConnectionTriggerState=any&qaConnectionRole=customer&qaConnectionRecoveryMs=${RECOVERY_MS}&qaNonce=${slug}"
}

relaunch_app() {
  local udid="$1"
  xcrun simctl terminate "$udid" "$APP_ID" >/dev/null 2>&1 || true
  sleep 1
  foreground_app "$udid"
}

grant_location_permissions() {
  local udid="$1"
  xcrun simctl terminate "$udid" "$APP_ID" >/dev/null 2>&1 || true
  xcrun simctl privacy "$udid" grant location "$APP_ID" >/dev/null 2>&1 || true
  xcrun simctl privacy "$udid" grant location-always "$APP_ID" >/dev/null 2>&1 || true
}

cleanup_active_ride_if_needed() {
  log "attempting frontend cleanup of any dangling ride before reinstall"
  foreground_app "$DRIVER_UDID"
  open_url "$DRIVER_UDID" "leafapp://robotaxi/home?qaAutomation=1&qaDriverAction=accept_offer&qaNonce=wave4cleanup-accept"
  sleep 4
  open_url "$DRIVER_UDID" "leafapp://robotaxi/home?qaAutomation=1&qaDriverAction=arrive_pickup&qaNonce=wave4cleanup-arrive"
  sleep 4
  open_url "$DRIVER_UDID" "leafapp://robotaxi/home?qaAutomation=1&qaDriverAction=start_trip&qaNonce=wave4cleanup-start"
  sleep 4
  open_url "$DRIVER_UDID" "leafapp://robotaxi/home?qaAutomation=1&qaDriverAction=complete_trip&qaNonce=wave4cleanup-complete"
  sleep 8
}

if [[ ! -d "$APP_PATH" ]]; then
  echo "[validation][error] app not found: $APP_PATH" >&2
  exit 1
fi

cleanup_active_ride_if_needed

log "installing current build on both simulators"
xcrun simctl terminate "$PASSENGER_UDID" "$APP_ID" >/dev/null 2>&1 || true
xcrun simctl terminate "$DRIVER_UDID" "$APP_ID" >/dev/null 2>&1 || true
xcrun simctl uninstall "$PASSENGER_UDID" "$APP_ID" >/dev/null 2>&1 || true
xcrun simctl uninstall "$DRIVER_UDID" "$APP_ID" >/dev/null 2>&1 || true
xcrun simctl install "$PASSENGER_UDID" "$APP_PATH"
xcrun simctl install "$DRIVER_UDID" "$APP_PATH"
suppress_dev_client_onboarding "$PASSENGER_UDID"
suppress_dev_client_onboarding "$DRIVER_UDID"
rm -f "$(dev_client_marker_path "$PASSENGER_UDID")" "$(dev_client_marker_path "$DRIVER_UDID")"
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
wait_and_capture_pair "00-baseline-relaunch"

log "driver online baseline"
run_driver_action set_online wave4online01
wait_and_capture_pair "01-driver-online"

log "driver connection loss/recovery on home"
run_disconnect_recover "$DRIVER_UDID" driver any "02-driver-online-disconnect"
wait_and_capture_single "$DRIVER_UDID" "02-driver-online-lost-15s"
wait_and_capture_single "$DRIVER_UDID" "02-driver-online-recovered-30s"

log "passenger quote connection loss/recovery"
run_quote_disconnect_recover "03-passenger-quote-disconnect"
wait_and_capture_single "$PASSENGER_UDID" "03-passenger-quote-lost-15s"
wait_and_capture_single "$PASSENGER_UDID" "03-passenger-quote-recovered-30s"

log "passenger request enters searching"
run_passenger_request wave4request04
wait_and_capture_pair "04-passenger-searching-baseline"

log "passenger connection loss/recovery while searching"
run_disconnect_recover "$PASSENGER_UDID" customer searching "05-passenger-searching-disconnect"
wait_and_capture_pair "05-passenger-searching-lost-15s"
wait_and_capture_pair "05-passenger-searching-recovered-30s"

log "passenger relaunch while searching"
relaunch_app "$PASSENGER_UDID"
wait_and_capture_pair "06-passenger-searching-relaunch-15s"

log "re-arming driver online before acceptance"
run_driver_action set_online wave4online02
wait_and_capture_pair "06b-driver-online-rearmed"

log "driver accepts offer"
run_driver_action accept_offer wave4step03
wait_and_capture_pair "07-driver-accepted-baseline"

log "passenger connection loss/recovery while accepted"
run_disconnect_recover "$PASSENGER_UDID" customer accepted "08-passenger-accepted-disconnect"
wait_and_capture_pair "08-passenger-accepted-lost-15s"
wait_and_capture_pair "08-passenger-accepted-recovered-30s"

log "driver arrives and starts trip"
run_driver_action arrive_pickup wave4step04
wait_and_capture_pair "09-driver-arrived-baseline"
run_driver_action start_trip wave4step05
wait_and_capture_pair "10-driver-started-baseline"

log "passenger connection loss/recovery while started"
run_disconnect_recover "$PASSENGER_UDID" customer started "11-passenger-started-disconnect"
wait_and_capture_pair "11-passenger-started-lost-15s"
wait_and_capture_pair "11-passenger-started-recovered-30s"

log "driver connection loss/recovery while started"
run_disconnect_recover "$DRIVER_UDID" driver started "12-driver-started-disconnect"
wait_and_capture_pair "12-driver-started-lost-15s"
wait_and_capture_pair "12-driver-started-recovered-30s"

log "dual relaunch while started"
relaunch_app "$PASSENGER_UDID"
relaunch_app "$DRIVER_UDID"
wait_and_capture_pair "13-dual-relaunch-started-15s"

SUMMARY_PATH="${ARTIFACT_DIR}/summary.md"
write_summary_file "$SUMMARY_PATH" "# Wave 4 Visual iOS Validation\n\n- Run dir: ${RUN_DIR}\n- Artifact dir: ${ARTIFACT_DIR}\n- Coverage: quote, driver_online, searching, accepted, started, relaunch\n- Rule: 15s before every screenshot\n"

log "wave4 visual validation finished"
log "artifacts: ${ARTIFACT_DIR}"
