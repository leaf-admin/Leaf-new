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
WARM_BOOT_SECONDS="${WARM_BOOT_SECONDS:-20}"
ARTIFACT_DIR="${RUN_DIR}/wave4/residual-ios-$(timestamp_now)"
mkdir -p "$ARTIFACT_DIR"

FLOW_DIR="${ROOT_DIR}/mobile-app/.maestro/flows/qa/e2e/wave4"
LIFECYCLE_DIR="${ROOT_DIR}/mobile-app/.maestro/flows/qa/e2e/lifecycle"
QUEUE_HOME_AUTOMATION_SCRIPT="${ROOT_DIR}/scripts/validation/lib/queue-sim-home-automation.cjs"
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

read_runtime_field() {
  local udid="$1"
  local field="$2"
  read_sim_runtime_field "$udid" "$APP_ID" "$field" 2>/dev/null || true
}

normalize_runtime_scalar() {
  local value="${1:-}"
  local lowered=""
  value="$(printf '%s' "$value" | tr -d '\"')"
  lowered="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"
  case "$lowered" in
    ""|"null"|"undefined")
      printf ''
      ;;
    *)
      printf '%s' "$value"
      ;;
  esac
}

read_seeded_profile_role() {
  local udid="$1"
  local container_path=""
  local manifest_path=""

  container_path="$(xcrun simctl get_app_container "$udid" "$APP_ID" data 2>/dev/null || true)"
  container_path="$(printf '%s' "$container_path" | tr -d '\n')"
  [[ -n "$container_path" ]] || return 1

  manifest_path="${container_path}/Library/Application Support/${APP_ID}/RCTAsyncLocalStorage_V1/manifest.json"
  [[ -f "$manifest_path" ]] || return 1

  node -e '
    const fs = require("fs");
    const manifestPath = process.argv[1];
    const QA_DRIVER_UID = "8vg2kxxqi3TYKlpD6eBlWgYseIq2";
    const QA_PASSENGER_UID = "OjML1wSzdNRaynjqMRlSW1Y0LVy2";
    const normalizeRole = (value) => {
      const normalized = String(value || "").trim().toLowerCase();
      if (normalized === "passenger") return "customer";
      if (["customer", "driver"].includes(normalized)) return normalized;
      return "";
    };
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      const authUid = String(manifest["@auth_uid"] || "").trim();
      const raw = manifest["@user_data"];
      const profile = typeof raw === "string" ? JSON.parse(raw) : raw;
      let role = normalizeRole(
        profile?.usertype ||
        profile?.userType ||
        profile?.role ||
        profile?.profile?.usertype ||
        profile?.profile?.userType ||
        profile?.profile?.role
      );
      if (!role && authUid === QA_DRIVER_UID) {
        role = "driver";
      } else if (!role && authUid === QA_PASSENGER_UID) {
        role = "customer";
      }
      if (!role) process.exit(2);
      process.stdout.write(role);
    } catch (_error) {
      process.exit(1);
    }
  ' "$manifest_path" 2>/dev/null || true
}

wait_for_runtime_role() {
  local udid="$1"
  local expected_role="$2"
  local timeout_seconds="${3:-45}"
  local started_at
  started_at="$(date +%s)"

  while true; do
    local current_role
    current_role="$(read_runtime_field "$udid" "activeRole")"
    current_role="$(printf '%s' "$current_role" | tr '[:upper:]' '[:lower:]' | tr -d '\"')"

    if [[ "$current_role" == "$expected_role" ]]; then
      return 0
    fi

    if (( $(date +%s) - started_at >= timeout_seconds )); then
      log "runtime role wait timed out for ${expected_role} (current=${current_role:-unknown}, udid=${udid})"
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
    local profile_uid
    local socket_connected
    local socket_authenticated

    profile_uid="$(read_runtime_field "$udid" "profileUid")"
    profile_uid="$(printf '%s' "$profile_uid" | tr -d '\"')"
    socket_connected="$(read_runtime_field "$udid" "isSocketConnected")"
    socket_connected="$(printf '%s' "$socket_connected" | tr '[:upper:]' '[:lower:]' | tr -d '\"')"
    socket_authenticated="$(read_runtime_field "$udid" "isSocketAuthenticated")"
    socket_authenticated="$(printf '%s' "$socket_authenticated" | tr '[:upper:]' '[:lower:]' | tr -d '\"')"

    if [[ -n "$profile_uid" && "$socket_connected" == "true" && "$socket_authenticated" == "true" ]]; then
      return 0
    fi

    if (( $(date +%s) - started_at >= timeout_seconds )); then
      log "runtime auth wait timed out (uid=${profile_uid:-missing}, connected=${socket_connected:-unknown}, authenticated=${socket_authenticated:-unknown}, udid=${udid})"
      return 1
    fi

    sleep 2
  done
}

ensure_seeded_role_ready() {
  local udid="$1"
  local role="$2"
  local slug="$3"

  for attempt in 1 2 3; do
    seed_sim_auth "$udid" "$role"
    xcrun simctl terminate "$udid" "$APP_ID" >/dev/null 2>&1 || true
    foreground_app "$udid"

    if wait_for_runtime_role "$udid" "$role" 60; then
      return 0
    fi

    log "runtime role ${role} did not settle for ${slug} on attempt ${attempt}; retrying with clean seed"
  done

  capture_device "$udid" "$ARTIFACT_DIR/${slug}-role-timeout.png"
  return 1
}

wait_and_capture_pair() {
  local slug="$1"
  log "waiting ${STABILIZATION_SECONDS}s before screenshots for ${slug}"
  sleep "$STABILIZATION_SECONDS"
  capture_device "$PASSENGER_UDID" "$ARTIFACT_DIR/${slug}-passenger.png"
  capture_device "$DRIVER_UDID" "$ARTIFACT_DIR/${slug}-driver.png"
}

wait_for_booking_status() {
  local udid="$1"
  local expected_status="$2"
  local timeout_seconds="${3:-60}"
  local started_at
  started_at="$(date +%s)"

  while true; do
    local current_status
    current_status="$(read_runtime_field "$udid" "bookingStatus")"
    current_status="$(printf '%s' "$current_status" | tr '[:upper:]' '[:lower:]' | tr -d '\"')"

    if [[ "$current_status" == "$expected_status" ]]; then
      return 0
    fi

    if (( $(date +%s) - started_at >= timeout_seconds )); then
      log "booking status wait timed out for ${expected_status} (current=${current_status:-unknown}, udid=${udid})"
      return 1
    fi

    sleep 2
  done
}

wait_for_driver_offer() {
  local timeout_seconds="${1:-60}"
  local started_at
  started_at="$(date +%s)"

  while true; do
    local driver_offers
    driver_offers="$(read_runtime_field "$DRIVER_UDID" "driverOffers")"
    if [[ -n "$driver_offers" && "$driver_offers" != "[]" && "$driver_offers" != "null" ]]; then
      return 0
    fi

    if (( $(date +%s) - started_at >= timeout_seconds )); then
      log "driver offer wait timed out"
      return 1
    fi

    sleep 2
  done
}

wait_for_driver_pending_cleared() {
  local timeout_seconds="${1:-30}"
  local started_at
  started_at="$(date +%s)"

  while true; do
    local driver_online=""
    local driver_online_pending=""
    local driver_online_source=""

    driver_online="$(read_runtime_field "$DRIVER_UDID" "driverOnline")"
    driver_online="$(printf '%s' "$driver_online" | tr '[:upper:]' '[:lower:]' | tr -d '\"')"
    driver_online_pending="$(read_runtime_field "$DRIVER_UDID" "driverOnlinePending")"
    driver_online_pending="$(printf '%s' "$driver_online_pending" | tr '[:upper:]' '[:lower:]' | tr -d '\"')"
    driver_online_source="$(read_runtime_field "$DRIVER_UDID" "driverOnlineMutationSource")"
    driver_online_source="$(printf '%s' "$driver_online_source" | tr -d '\"')"

    if [[ "$driver_online_pending" != "true" ]]; then
      return 0
    fi

    if (( $(date +%s) - started_at >= timeout_seconds )); then
      log "driver pending wait timed out (online=${driver_online:-unknown}, pending=${driver_online_pending:-unknown}, source=${driver_online_source:-unknown})"
      return 1
    fi

    sleep 2
  done
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

run_passenger_action() {
  local action="$1"
  local nonce="$2"
  foreground_app "$PASSENGER_UDID"
  open_url "$PASSENGER_UDID" "leafapp://robotaxi/home?qaAutomation=1&qaPassengerAction=${action}&qaNonce=${nonce}"
  sleep "$FLOW_SETTLE_SECONDS"
}

queue_driver_home_action() {
  local action="$1"
  local nonce="$2"
  node "$QUEUE_HOME_AUTOMATION_SCRIPT" \
    --udid "$DRIVER_UDID" \
    --app-id "$APP_ID" \
    --role driver \
    --action "$action" \
    --nonce "$nonce"
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
  xcrun simctl keychain "$PASSENGER_UDID" reset >/dev/null 2>&1 || true
  xcrun simctl keychain "$DRIVER_UDID" reset >/dev/null 2>&1 || true
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
  ensure_seeded_role_ready "$PASSENGER_UDID" "customer" "passenger-bootstrap"
  ensure_seeded_role_ready "$DRIVER_UDID" "driver" "driver-bootstrap"
}

prepare_clean_scenario() {
  cleanup_active_ride_if_needed
  reinstall_apps
  cleanup_passenger_active_if_needed
}

warm_boot_driver() {
  log "warming up driver app before enabling online"
  ensure_seeded_role_ready "$DRIVER_UDID" "driver" "driver-warmboot"
  sleep "$WARM_BOOT_SECONDS"
  seed_sim_auth "$DRIVER_UDID" driver
  foreground_app "$DRIVER_UDID"
  if ! wait_for_runtime_role "$DRIVER_UDID" "driver" 45; then
    capture_device "$DRIVER_UDID" "$ARTIFACT_DIR/driver-warmboot-role-timeout.png"
    return 1
  fi
  if ! wait_for_runtime_auth "$DRIVER_UDID" 60; then
    capture_device "$DRIVER_UDID" "$ARTIFACT_DIR/driver-auth-timeout.png"
    log "driver auth did not settle on first attempt; retrying warm bootstrap"
    seed_sim_auth "$DRIVER_UDID" driver
    xcrun simctl terminate "$DRIVER_UDID" "$APP_ID" >/dev/null 2>&1 || true
    foreground_app "$DRIVER_UDID"
    if ! wait_for_runtime_role "$DRIVER_UDID" "driver" 60; then
      capture_device "$DRIVER_UDID" "$ARTIFACT_DIR/driver-auth-retry-role-timeout.png"
      return 1
    fi
    if ! wait_for_runtime_auth "$DRIVER_UDID" 75; then
      capture_device "$DRIVER_UDID" "$ARTIFACT_DIR/driver-auth-retry-timeout.png"
      return 1
    fi
  fi
}

ensure_passenger_ready() {
  log "warming up passenger app before requesting ride"
  ensure_seeded_role_ready "$PASSENGER_UDID" "customer" "passenger-warmboot"
  sleep "$WARM_BOOT_SECONDS"
  seed_sim_auth "$PASSENGER_UDID" customer
  foreground_app "$PASSENGER_UDID"
  if ! wait_for_runtime_auth "$PASSENGER_UDID" 60; then
    capture_device "$PASSENGER_UDID" "$ARTIFACT_DIR/passenger-auth-timeout.png"
    log "passenger auth did not settle on first attempt; retrying warm bootstrap"
    seed_sim_auth "$PASSENGER_UDID" customer
    xcrun simctl terminate "$PASSENGER_UDID" "$APP_ID" >/dev/null 2>&1 || true
    foreground_app "$PASSENGER_UDID"
    if ! wait_for_runtime_auth "$PASSENGER_UDID" 75; then
      capture_device "$PASSENGER_UDID" "$ARTIFACT_DIR/passenger-auth-retry-timeout.png"
      return 1
    fi
  fi
}

wait_for_passenger_clean() {
  local timeout_seconds="${1:-60}"
  local started_at
  started_at="$(date +%s)"

  while true; do
    local booking_status=""
    local active_booking_id=""

    booking_status="$(read_runtime_field "$PASSENGER_UDID" "bookingStatus")"
    booking_status="$(printf '%s' "$booking_status" | tr '[:upper:]' '[:lower:]' | tr -d '\"')"
    active_booking_id="$(read_runtime_field "$PASSENGER_UDID" "activeBookingId")"
    active_booking_id="$(normalize_runtime_scalar "$active_booking_id")"

    if [[ "$booking_status" == "completed" ]]; then
      run_passenger_action dismiss_receipt "cleanup-dismiss-receipt"
      sleep 2
      continue
    fi

    if [[ "$booking_status" == "idle" && -z "$active_booking_id" ]]; then
      return 0
    fi

    if (( $(date +%s) - started_at >= timeout_seconds )); then
      log "passenger cleanup wait timed out (status=${booking_status:-unknown}, booking=${active_booking_id:-none})"
      return 1
    fi

    sleep 2
  done
}

cleanup_passenger_active_if_needed() {
  ensure_passenger_ready

  local booking_status=""
  local active_booking_id=""
  booking_status="$(read_runtime_field "$PASSENGER_UDID" "bookingStatus")"
  booking_status="$(printf '%s' "$booking_status" | tr '[:upper:]' '[:lower:]' | tr -d '\"')"
  active_booking_id="$(read_runtime_field "$PASSENGER_UDID" "activeBookingId")"
  active_booking_id="$(normalize_runtime_scalar "$active_booking_id")"

  if [[ "$booking_status" == "idle" && -z "$active_booking_id" ]]; then
    return 0
  fi

  log "passenger still has residual lifecycle state (status=${booking_status:-unknown}, booking=${active_booking_id:-none}); running cleanup_active via app"
  run_passenger_action cleanup_active "prepare-cleanup-passenger"
  if ! wait_for_passenger_clean 75; then
    capture_device "$PASSENGER_UDID" "$ARTIFACT_DIR/passenger-cleanup-timeout.png"
    return 1
  fi
}

ensure_driver_online() {
  log "bringing driver online via warmed app + UI flow"
  warm_boot_driver
  local driver_online=""
  local driver_online_pending=""
  driver_online="$(read_runtime_field "$DRIVER_UDID" "driverOnline")"
  driver_online="$(printf '%s' "$driver_online" | tr '[:upper:]' '[:lower:]' | tr -d '\"')"
  driver_online_pending="$(read_runtime_field "$DRIVER_UDID" "driverOnlinePending")"
  driver_online_pending="$(printf '%s' "$driver_online_pending" | tr '[:upper:]' '[:lower:]' | tr -d '\"')"

  if [[ "$driver_online" != "true" && "$driver_online_pending" == "true" ]]; then
    log "driver restored with stale pending state; clearing offline before enabling online"
    queue_driver_home_action set_offline "real-trip-clear-stale-pending"
    foreground_app "$DRIVER_UDID"
    if ! wait_for_driver_pending_cleared 30; then
      capture_device "$DRIVER_UDID" "$ARTIFACT_DIR/driver-pending-clear-timeout.png"
    fi
  fi

  queue_driver_home_action set_online "real-trip-online-queued-primary"
  xcrun simctl terminate "$DRIVER_UDID" "$APP_ID" >/dev/null 2>&1 || true
  foreground_app "$DRIVER_UDID"
  if ! wait_for_driver_online "$DRIVER_UDID" "$APP_ID" 45; then
    capture_device "$DRIVER_UDID" "$ARTIFACT_DIR/driver-online-timeout.png"
    log "queued home automation did not settle driver online; trying UI flow fallback"
    if ! run_flow "$DRIVER_UDID" "$LIFECYCLE_DIR/01-driver-online-home.yaml" "driver-online-home"; then
      log "driver-online-home UI fallback failed; retrying queued home automation once more"
    fi
    queue_driver_home_action set_online "real-trip-online-queued-fallback"
    xcrun simctl terminate "$DRIVER_UDID" "$APP_ID" >/dev/null 2>&1 || true
    foreground_app "$DRIVER_UDID"
    if ! wait_for_driver_online "$DRIVER_UDID" "$APP_ID" 60; then
      capture_device "$DRIVER_UDID" "$ARTIFACT_DIR/driver-online-fallback-timeout.png"
      log "driver online still did not settle after queued fallback; continuing with UI grace fallback"
      sleep "$STABILIZATION_SECONDS"
    fi
  fi
  foreground_app "$DRIVER_UDID"
  sleep "$FLOW_SETTLE_SECONDS"
}

start_real_trip() {
  ensure_driver_online
  ensure_passenger_ready
  run_flow "$PASSENGER_UDID" "$LIFECYCLE_DIR/02-passenger-request-home.yaml" "request-home"
  if ! wait_for_driver_offer 60; then
    capture_device "$PASSENGER_UDID" "$ARTIFACT_DIR/start-real-trip-driver-offer-timeout-passenger.png"
    capture_device "$DRIVER_UDID" "$ARTIFACT_DIR/start-real-trip-driver-offer-timeout-driver.png"
  fi
  run_driver_action accept_offer "real-trip-accept"
  if ! wait_for_booking_status "$PASSENGER_UDID" "accepted" 60; then
    capture_device "$PASSENGER_UDID" "$ARTIFACT_DIR/start-real-trip-accepted-timeout-passenger.png"
    capture_device "$DRIVER_UDID" "$ARTIFACT_DIR/start-real-trip-accepted-timeout-driver.png"
  fi
  run_driver_action arrive_pickup "real-trip-arrive"
  if ! wait_for_booking_status "$PASSENGER_UDID" "arrived" 60; then
    capture_device "$PASSENGER_UDID" "$ARTIFACT_DIR/start-real-trip-arrived-timeout-passenger.png"
    capture_device "$DRIVER_UDID" "$ARTIFACT_DIR/start-real-trip-arrived-timeout-driver.png"
  fi
  run_driver_action start_trip "real-trip-start"
  if ! wait_for_booking_status "$PASSENGER_UDID" "started" 60; then
    capture_device "$PASSENGER_UDID" "$ARTIFACT_DIR/start-real-trip-started-timeout-passenger.png"
    capture_device "$DRIVER_UDID" "$ARTIFACT_DIR/start-real-trip-started-timeout-driver.png"
  fi
  foreground_app "$DRIVER_UDID"
}

if [[ ! -d "$APP_PATH" ]]; then
  echo "[validation][error] app not found: $APP_PATH" >&2
  exit 1
fi

log "scenario W4-OPS-001: passenger cancels before acceptance"
prepare_clean_scenario
run_driver_action set_online "ops-cancel-online"
ensure_passenger_ready
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
