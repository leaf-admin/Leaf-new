#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${1:-${LEAF_API_BASE_URL:-https://api.leaf.app.br}}"
INTERVAL_SECONDS="${INTERVAL_SECONDS:-20}"
MAX_SAMPLES="${MAX_SAMPLES:-0}"
OUTPUT_FILE="${OUTPUT_FILE:-}"
AUTH_TOKEN="${AUTH_TOKEN:-${LEAF_ADMIN_BEARER_TOKEN:-}}"
TIMEOUT="${TIMEOUT:-12}"

sample_count=0

if [[ -z "${OUTPUT_FILE}" ]]; then
  stamp="$(date +%Y%m%d_%H%M%S)"
  OUTPUT_FILE="/tmp/leaf-pilot-ops-watch-${stamp}.log"
fi

curl_json() {
  local url="$1"
  local body_file="$2"
  shift 2 || true
  curl -sS -m "${TIMEOUT}" -o "${body_file}" -w "%{http_code}" "$@" "${url}" 2>/dev/null || echo "000"
}

jq_safe() {
  local filter="$1"
  local body_file="$2"
  jq -r "${filter}" "${body_file}" 2>/dev/null || true
}

compact_text() {
  local raw="$1"
  raw="${raw//$'\n'/ }"
  raw="${raw//\"/\'}"
  printf '%s' "${raw}" | tr -s ' '
}

fetch_auth_json() {
  local url="$1"
  local body_file="$2"

  if [[ -n "${AUTH_TOKEN}" ]]; then
    curl_json "${url}" "${body_file}" -H "Authorization: Bearer ${AUTH_TOKEN}"
    return
  fi

  echo "skipped"
}

print_header() {
  echo "# Leaf pilot operations watch" | tee -a "${OUTPUT_FILE}"
  echo "# base_url=${API_BASE_URL}" | tee -a "${OUTPUT_FILE}"
  echo "# interval_seconds=${INTERVAL_SECONDS}" | tee -a "${OUTPUT_FILE}"
  echo "# output_file=${OUTPUT_FILE}" | tee -a "${OUTPUT_FILE}"
  if [[ -n "${AUTH_TOKEN}" ]]; then
    echo "# auth=present" | tee -a "${OUTPUT_FILE}"
  else
    echo "# auth=absent" | tee -a "${OUTPUT_FILE}"
  fi
}

print_header

while true; do
  sample_count=$((sample_count + 1))
  timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  health_body="$(mktemp)"
  rides_body="$(mktemp)"
  activity_body="$(mktemp)"
  overview_body="$(mktemp)"
  observability_body="$(mktemp)"
  financial_body="$(mktemp)"

  health_code="$(curl_json "${API_BASE_URL}/health" "${health_body}")"
  rides_code="$(curl_json "${API_BASE_URL}/api/rides/stats?period=today" "${rides_body}")"
  activity_code="$(curl_json "${API_BASE_URL}/api/activity/recent" "${activity_body}")"
  overview_code="$(curl_json "${API_BASE_URL}/api/metrics/overview" "${overview_body}")"
  observability_code="$(fetch_auth_json "${API_BASE_URL}/api/metrics/observability" "${observability_body}")"
  financial_code="$(fetch_auth_json "${API_BASE_URL}/api/metrics/financial/rides?period=today" "${financial_body}")"

  health_state="$(jq_safe '.status // "n/a"' "${health_body}")"
  system_state="$(jq_safe '.checks.system.status // "n/a"' "${health_body}")"

  total_rides="$(jq_safe '.totalRides // 0' "${rides_body}")"
  active_rides="$(jq_safe '.activeRides // 0' "${rides_body}")"
  completed_today="$(jq_safe '.completedToday // 0' "${rides_body}")"
  average_value="$(jq_safe '.averageValue // 0' "${rides_body}")"

  activity_count="$(jq_safe 'if type == "array" then length else 0 end' "${activity_body}")"
  latest_activity_id="$(jq_safe 'if type == "array" then (.[0].id // "n/a") else "n/a" end' "${activity_body}")"
  latest_activity_desc="$(jq_safe 'if type == "array" then (.[0].description // "n/a") else "n/a" end' "${activity_body}")"
  activity_undefined_count="$(jq_safe 'if type == "array" then ([.[] | select(((.description // "") | tostring) | test("undefined"; "i"))] | length) else 0 end' "${activity_body}")"

  waitlist_count="$(jq_safe '.waitlistCount // "n/a"' "${overview_body}")"
  calculator_simulations="$(jq_safe '.calculatorSimulations // "n/a"' "${overview_body}")"

  websocket_connections="n/a"
  rides_requested="n/a"
  rides_accepted="n/a"
  rides_completed_obs="n/a"
  event_loop_p95="n/a"
  financial_total_value="n/a"
  financial_total_rides="n/a"

  if [[ "${observability_code}" == "200" ]]; then
    websocket_connections="$(jq_safe '.system.websocketConnections // "n/a"' "${observability_body}")"
    rides_requested="$(jq_safe '.rides.requested // "n/a"' "${observability_body}")"
    rides_accepted="$(jq_safe '.rides.accepted // "n/a"' "${observability_body}")"
    rides_completed_obs="$(jq_safe '.rides.completed // "n/a"' "${observability_body}")"
    event_loop_p95="$(jq_safe '.eventLoopLag.p95Ms // "n/a"' "${observability_body}")"
  elif [[ "${observability_code}" == "skipped" ]]; then
    websocket_connections="auth_skipped"
    rides_requested="auth_skipped"
    rides_accepted="auth_skipped"
    rides_completed_obs="auth_skipped"
    event_loop_p95="auth_skipped"
  fi

  if [[ "${financial_code}" == "200" ]]; then
    financial_total_value="$(jq_safe '.totalValue // "n/a"' "${financial_body}")"
    financial_total_rides="$(jq_safe '.totalRides // "n/a"' "${financial_body}")"
  elif [[ "${financial_code}" == "skipped" ]]; then
    financial_total_value="auth_skipped"
    financial_total_rides="auth_skipped"
  fi

  sample_status="PASS"
  if [[ "${health_code}" != "200" || "${rides_code}" != "200" || "${activity_code}" != "200" || "${overview_code}" != "200" ]]; then
    sample_status="FAIL"
  fi
  if [[ -n "${AUTH_TOKEN}" && ( "${observability_code}" != "200" || "${financial_code}" != "200" ) ]]; then
    sample_status="FAIL"
  fi

  activity_anomaly="no"
  if [[ "${activity_undefined_count}" != "0" ]]; then
    activity_anomaly="yes"
  fi

  rides_metric_anomaly="no"
  if [[ "${total_rides}" =~ ^[0-9]+$ && "${active_rides}" =~ ^[0-9]+$ && "${total_rides}" -gt 0 && "${active_rides}" -gt "${total_rides}" ]]; then
    rides_metric_anomaly="yes"
  fi

  printf '%s sample=%s status=%s health_code=%s health=%s system=%s rides_code=%s total_rides=%s active_rides=%s completed_today=%s avg_value=%s rides_metric_anomaly=%s activity_code=%s activity_count=%s activity_anomaly=%s latest_activity_id=%s latest_activity_desc="%s" overview_code=%s waitlist=%s calculator_simulations=%s observability_code=%s websocket_connections=%s rides_requested=%s rides_accepted=%s rides_completed_obs=%s event_loop_p95=%s financial_code=%s financial_total_value=%s financial_total_rides=%s\n' \
    "${timestamp}" \
    "${sample_count}" \
    "${sample_status}" \
    "${health_code}" \
    "${health_state:-n/a}" \
    "${system_state:-n/a}" \
    "${rides_code}" \
    "${total_rides:-n/a}" \
    "${active_rides:-n/a}" \
    "${completed_today:-n/a}" \
    "${average_value:-n/a}" \
    "${rides_metric_anomaly}" \
    "${activity_code}" \
    "${activity_count:-n/a}" \
    "${activity_anomaly}" \
    "${latest_activity_id:-n/a}" \
    "$(compact_text "${latest_activity_desc:-n/a}")" \
    "${overview_code}" \
    "${waitlist_count:-n/a}" \
    "${calculator_simulations:-n/a}" \
    "${observability_code}" \
    "${websocket_connections}" \
    "${rides_requested}" \
    "${rides_accepted}" \
    "${rides_completed_obs}" \
    "${event_loop_p95}" \
    "${financial_code}" \
    "${financial_total_value}" \
    "${financial_total_rides}" | tee -a "${OUTPUT_FILE}"

  rm -f "${health_body}" "${rides_body}" "${activity_body}" "${overview_body}" "${observability_body}" "${financial_body}"

  if [[ "${MAX_SAMPLES}" != "0" && "${sample_count}" -ge "${MAX_SAMPLES}" ]]; then
    break
  fi

  sleep "${INTERVAL_SECONDS}"
done

echo "# completed samples=${sample_count}" | tee -a "${OUTPUT_FILE}"
