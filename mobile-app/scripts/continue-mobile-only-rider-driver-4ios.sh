#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="/Users/izaakdias/Documents/Leaf-new"
MOBILE_DIR="${ROOT_DIR}/mobile-app"
ARTIFACTS_DIR="${1:-}"

if [[ -z "${ARTIFACTS_DIR}" ]]; then
  echo "usage: $0 <artifacts-dir>" >&2
  exit 1
fi

APP_ID="${APP_ID:-br.com.leaf.ride}"
READ_RUNTIME_SCRIPT="${ROOT_DIR}/scripts/validation/lib/read-sim-runtime-state.cjs"

PASSENGER_UDID="${PASSENGER_UDID:-195D2C57-87DC-4953-ABF1-4FD351ADBBEF}"
DRIVER_A_UDID="${DRIVER_A_UDID:-2E44BC8E-9AA8-43BE-BD5E-D0B5A73E543C}"
DRIVER_B_UDID="${DRIVER_B_UDID:-77B44D4A-7D05-4FC2-A84F-0B10715CC37F}"
DRIVER_C_UDID="${DRIVER_C_UDID:-BB96BE67-2C24-47BA-BFFB-199E72CA2E94}"

PICKUP_LAT="${PICKUP_LAT:--22.9190889}"
PICKUP_LNG="${PICKUP_LNG:--43.406699}"
DEST_LAT="${DEST_LAT:--22.9670133}"
DEST_LNG="${DEST_LNG:--43.1791899}"

FLOW_SETTLE_SECONDS="${FLOW_SETTLE_SECONDS:-2}"
RESUME_FROM="${RESUME_FROM:-pickup}"

mkdir -p "${ARTIFACTS_DIR}/runtime"

append_timeline() {
  local stage="$1"
  local details="${2:-{}}"
  node -e '
    const fs = require("fs");
    const [file, stage, details] = process.argv.slice(1);
    const line = JSON.stringify({
      stage,
      at: new Date().toISOString(),
      details: JSON.parse(details || "{}"),
    });
    fs.appendFileSync(file, `${line}\n`);
  ' "${ARTIFACTS_DIR}/timeline.jsonl" "${stage}" "${details}"
}

capture_device() {
  local udid="$1"
  local output="$2"
  xcrun simctl io "${udid}" screenshot "${output}" >/dev/null
}

save_runtime_snapshot() {
  local udid="$1"
  local output="$2"
  node "${READ_RUNTIME_SCRIPT}" --udid "${udid}" --app-id "${APP_ID}" > "${output}"
}

capture_stage() {
  local slug="$1"
  local include_driver_b="${2:-true}"
  local include_driver_c="${3:-true}"

  capture_device "${PASSENGER_UDID}" "${ARTIFACTS_DIR}/${slug}-passenger.png"
  save_runtime_snapshot "${PASSENGER_UDID}" "${ARTIFACTS_DIR}/runtime/${slug}-passenger.json"

  capture_device "${DRIVER_A_UDID}" "${ARTIFACTS_DIR}/${slug}-driver-a.png"
  save_runtime_snapshot "${DRIVER_A_UDID}" "${ARTIFACTS_DIR}/runtime/${slug}-driver-a.json"

  if [[ "${include_driver_b}" == "true" ]]; then
    capture_device "${DRIVER_B_UDID}" "${ARTIFACTS_DIR}/${slug}-driver-b.png"
    save_runtime_snapshot "${DRIVER_B_UDID}" "${ARTIFACTS_DIR}/runtime/${slug}-driver-b.json"
  fi

  if [[ "${include_driver_c}" == "true" ]]; then
    capture_device "${DRIVER_C_UDID}" "${ARTIFACTS_DIR}/${slug}-driver-c.png"
    save_runtime_snapshot "${DRIVER_C_UDID}" "${ARTIFACTS_DIR}/runtime/${slug}-driver-c.json"
  fi
}

foreground_app() {
  local udid="$1"
  xcrun simctl openurl "${udid}" "leafapp://robotaxi/home?qaAutomation=1&qaNonce=resume-$(date +%s)" >/dev/null 2>&1 || true
  sleep "${FLOW_SETTLE_SECONDS}"
}

run_flow() {
  local udid="$1"
  local flow="$2"
  local output_dir="$3"
  foreground_app "${udid}"
  maestro test "${flow}" \
    --udid "${udid}" \
    --no-reinstall-driver \
    --test-output-dir "${output_dir}"
}

read_runtime_field() {
  local udid="$1"
  local field="$2"
  node "${READ_RUNTIME_SCRIPT}" --udid "${udid}" --app-id "${APP_ID}" --field "${field}" 2>/dev/null || true
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
      echo "timed out waiting for ${udid} status=${expected}; current=${value:-unknown}" >&2
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
      echo "timed out waiting for idle on ${udid}; status=${booking_status:-unknown} activeBookingId=${active_booking_id:-unknown}" >&2
      return 1
    fi
    sleep 2
  done
}

distance_to_target_meters() {
  local udid="$1"
  local target_lat="$2"
  local target_lng="$3"
  node "${READ_RUNTIME_SCRIPT}" --udid "${udid}" --app-id "${APP_ID}" 2>/dev/null | \
    node -e '
      const fs = require("fs");
      const raw = fs.readFileSync(0, "utf8");
      const snapshot = raw ? JSON.parse(raw) : {};
      const targetLat = Number(process.argv[1]);
      const targetLng = Number(process.argv[2]);
      const current = snapshot.driverCoordinate || snapshot.currentCoordinate || null;
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
      echo "timed out waiting for ${udid} distance <= ${threshold_meters}; current=${distance:-unknown}" >&2
      return 1
    fi
    sleep 5
  done
}

if [[ "${RESUME_FROM}" == "pickup" ]]; then
  capture_stage "06-driver-near-pickup"

  run_flow \
    "${DRIVER_A_UDID}" \
    "${MOBILE_DIR}/.maestro/flows/qa/e2e/lifecycle/05-driver-arrive-pickup.yaml" \
    "${ARTIFACTS_DIR}/05-driver-arrive-pickup"
  wait_for_status "${PASSENGER_UDID}" arrived 180
  wait_for_status "${DRIVER_A_UDID}" arrived 180
  append_timeline "driver_arrived_pickup"
  capture_stage "07-driver-arrived"

  run_flow \
    "${DRIVER_A_UDID}" \
    "${MOBILE_DIR}/.maestro/flows/qa/e2e/lifecycle/06-driver-start-trip.yaml" \
    "${ARTIFACTS_DIR}/06-driver-start-trip"
  wait_for_status "${PASSENGER_UDID}" started 180
  wait_for_status "${DRIVER_A_UDID}" started 180
  append_timeline "trip_started"
  capture_stage "08-trip-started"

  sleep 30
  capture_stage "09-trip-in-progress" false false
  append_timeline "trip_in_progress_evidence_captured"
fi

wait_until_distance_below "${DRIVER_A_UDID}" "${DEST_LAT}" "${DEST_LNG}" 120 5400
capture_stage "10-driver-near-destination" false false
run_flow \
  "${DRIVER_A_UDID}" \
  "${MOBILE_DIR}/.maestro/flows/qa/e2e/lifecycle/07-driver-complete-trip.yaml" \
  "${ARTIFACTS_DIR}/07-driver-complete-trip"
wait_for_status "${PASSENGER_UDID}" completed 240
append_timeline "trip_completed"
capture_stage "11-trip-completed" false false

run_flow \
  "${PASSENGER_UDID}" \
  "${MOBILE_DIR}/.maestro/flows/qa/e2e/lifecycle/07-passenger-rate-trip.yaml" \
  "${ARTIFACTS_DIR}/08-passenger-rate"
append_timeline "passenger_rating_submitted"
capture_stage "12-passenger-rated" false false

run_flow \
  "${DRIVER_A_UDID}" \
  "${MOBILE_DIR}/.maestro/flows/qa/e2e/lifecycle/08-driver-rate-passenger.yaml" \
  "${ARTIFACTS_DIR}/09-driver-rate-passenger"
append_timeline "driver_rating_submitted"
capture_stage "13-driver-rated" false false

run_flow \
  "${PASSENGER_UDID}" \
  "${MOBILE_DIR}/.maestro/flows/qa/e2e/lifecycle/10-passenger-receipt-back-to-map.yaml" \
  "${ARTIFACTS_DIR}/10-passenger-back-to-map"
run_flow \
  "${DRIVER_A_UDID}" \
  "${MOBILE_DIR}/.maestro/flows/qa/e2e/lifecycle/09-driver-receipt-back-to-map.yaml" \
  "${ARTIFACTS_DIR}/11-driver-back-to-map"
wait_for_idle "${PASSENGER_UDID}" 180
append_timeline "apps_back_to_map"
capture_stage "14-reset-state" false false

run_flow \
  "${DRIVER_A_UDID}" \
  "${MOBILE_DIR}/.maestro/flows/qa/e2e/lifecycle/11-driver-open-earnings.yaml" \
  "${ARTIFACTS_DIR}/12-driver-open-earnings"
append_timeline "driver_earnings_opened"
capture_stage "15-driver-earnings" false false
