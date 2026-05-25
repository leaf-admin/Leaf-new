#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/common.sh"
LABEL="wave4-end-early-ideal-paced"
while [[ $# -gt 0 ]]; do case "$1" in --label) LABEL="$2"; shift 2;; *) exit 1;; esac; done
ensure_run_dir "$LABEL"
PASSENGER_UDID="${PASSENGER_UDID:-195D2C57-87DC-4953-ABF1-4FD351ADBBEF}"
DRIVER_UDID="${DRIVER_UDID:-2E44BC8E-9AA8-43BE-BD5E-D0B5A73E543C}"
APP_ID="${APP_ID:-br.com.leaf.ride}"
APP_PATH="${APP_PATH:-${ROOT_DIR}/mobile-app/ios/build/Build/Products/Release-iphonesimulator/Leaf.app}"
STABILIZATION_SECONDS="${STABILIZATION_SECONDS:-15}"
FLOW_SETTLE_SECONDS="${FLOW_SETTLE_SECONDS:-6}"
ARTIFACT_DIR="${RUN_DIR}/wave4/end-early-ideal-paced-$(timestamp_now)"
mkdir -p "$ARTIFACT_DIR"
LIFECYCLE_DIR="${ROOT_DIR}/mobile-app/.maestro/flows/qa/e2e/lifecycle"
FLOW_DIR="${ROOT_DIR}/mobile-app/.maestro/flows/qa/e2e/wave4"
QUEUE_HOME_AUTOMATION_SCRIPT="${ROOT_DIR}/scripts/validation/lib/queue-sim-home-automation.cjs"
SEED_AUTH_SCRIPT="${ROOT_DIR}/scripts/validation/lib/seed-sim-auth.cjs"
GUARDED_IOS_LAUNCH_SCRIPT="${ROOT_DIR}/scripts/validation/lib/guarded-ios-launch.sh"
foreground_app(){ local launch_artifacts_dir="$ARTIFACT_DIR/_launch_watch/$1"; mkdir -p "$launch_artifacts_dir"; bash "$GUARDED_IOS_LAUNCH_SCRIPT" "$1" "$APP_ID" "$FLOW_SETTLE_SECONDS" "$launch_artifacts_dir" >/dev/null; }
open_url(){ xcrun simctl openurl "$1" "$2"; }
capture(){ xcrun simctl io "$1" screenshot "$2" >/dev/null; }
waitcap(){ local slug="$1"; foreground_app "$PASSENGER_UDID"; foreground_app "$DRIVER_UDID"; sleep "$STABILIZATION_SECONDS"; capture "$PASSENGER_UDID" "$ARTIFACT_DIR/${slug}-passenger.png"; capture "$DRIVER_UDID" "$ARTIFACT_DIR/${slug}-driver.png"; }
flow(){ foreground_app "$1"; maestro test "$2" --udid "$1" --no-reinstall-driver --test-output-dir "$ARTIFACT_DIR/maestro-$3" >/dev/null; }
driver_action(){ foreground_app "$DRIVER_UDID"; open_url "$DRIVER_UDID" "leafapp://robotaxi/home?qaAutomation=1&qaDriverAction=$1&qaNonce=$2"; sleep "$FLOW_SETTLE_SECONDS"; }
passenger_action(){ foreground_app "$PASSENGER_UDID"; open_url "$PASSENGER_UDID" "leafapp://robotaxi/home?qaAutomation=1&qaPassengerAction=$1&qaNonce=$2"; sleep "$FLOW_SETTLE_SECONDS"; }
queue_driver_home_action(){ node "$QUEUE_HOME_AUTOMATION_SCRIPT" --udid "$DRIVER_UDID" --app-id "$APP_ID" --role driver --action "$1" --nonce "$2"; }
seed_sim_auth(){ node "$SEED_AUTH_SCRIPT" --udid "$1" --app-id "$APP_ID" --role "$2"; }
perm(){ xcrun simctl terminate "$1" "$APP_ID" >/dev/null 2>&1 || true; xcrun simctl privacy "$1" grant location "$APP_ID" >/dev/null 2>&1 || true; xcrun simctl privacy "$1" grant location-always "$APP_ID" >/dev/null 2>&1 || true; }
cleanup(){ passenger_action cleanup_active eecleanp1; driver_action accept_offer eeclean1; sleep 3; driver_action arrive_pickup eeclean2; sleep 3; driver_action start_trip eeclean3; sleep 3; driver_action complete_trip eeclean4; sleep 3; passenger_action cleanup_active eecleanp2; sleep 6; }
reinstall(){ xcrun simctl terminate "$PASSENGER_UDID" "$APP_ID" >/dev/null 2>&1 || true; xcrun simctl terminate "$DRIVER_UDID" "$APP_ID" >/dev/null 2>&1 || true; xcrun simctl uninstall "$PASSENGER_UDID" "$APP_ID" >/dev/null 2>&1 || true; xcrun simctl uninstall "$DRIVER_UDID" "$APP_ID" >/dev/null 2>&1 || true; xcrun simctl install "$PASSENGER_UDID" "$APP_PATH"; xcrun simctl install "$DRIVER_UDID" "$APP_PATH"; perm "$PASSENGER_UDID"; perm "$DRIVER_UDID"; seed_sim_auth "$PASSENGER_UDID" customer; seed_sim_auth "$DRIVER_UDID" driver; foreground_app "$PASSENGER_UDID"; foreground_app "$DRIVER_UDID"; seed_sim_auth "$PASSENGER_UDID" customer; seed_sim_auth "$DRIVER_UDID" driver; xcrun simctl terminate "$PASSENGER_UDID" "$APP_ID" >/dev/null 2>&1 || true; xcrun simctl terminate "$DRIVER_UDID" "$APP_ID" >/dev/null 2>&1 || true; foreground_app "$PASSENGER_UDID"; foreground_app "$DRIVER_UDID"; }
ensure_driver_online(){ queue_driver_home_action set_online real-trip-online; xcrun simctl terminate "$DRIVER_UDID" "$APP_ID" >/dev/null 2>&1 || true; foreground_app "$DRIVER_UDID"; if ! wait_for_driver_online "$DRIVER_UDID" "$APP_ID" 60; then capture "$DRIVER_UDID" "$ARTIFACT_DIR/driver-online-timeout.png"; log "driver online runtime snapshot did not settle; continuing with UI grace fallback"; sleep "$STABILIZATION_SECONDS"; fi; foreground_app "$DRIVER_UDID"; sleep "$FLOW_SETTLE_SECONDS"; }
cleanup
reinstall
ensure_driver_online
flow "$PASSENGER_UDID" "$LIFECYCLE_DIR/02-passenger-request-home.yaml" request
waitcap 01-searching
driver_action accept_offer eeaccept
waitcap 02-accepted
driver_action arrive_pickup eearrive
waitcap 03-arrived
driver_action start_trip eestart
waitcap 04-started
flow "$PASSENGER_UDID" "$FLOW_DIR/05-passenger-end-early.yaml" end-early
waitcap 05-end-early-result
log "artifacts: ${ARTIFACT_DIR}"
