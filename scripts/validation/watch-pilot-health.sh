#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${1:-${LEAF_API_BASE_URL:-https://api.leaf.app.br}}"
INTERVAL_SECONDS="${INTERVAL_SECONDS:-10}"
MAX_SAMPLES="${MAX_SAMPLES:-0}"
OUTPUT_FILE="${OUTPUT_FILE:-}"

sample_count=0

if [[ -z "${OUTPUT_FILE}" ]]; then
  stamp="$(date +%Y%m%d_%H%M%S)"
  OUTPUT_FILE="/tmp/leaf-pilot-health-watch-${stamp}.log"
fi

echo "# Leaf pilot health watch" | tee -a "${OUTPUT_FILE}"
echo "# base_url=${API_BASE_URL}" | tee -a "${OUTPUT_FILE}"
echo "# interval_seconds=${INTERVAL_SECONDS}" | tee -a "${OUTPUT_FILE}"
echo "# output_file=${OUTPUT_FILE}" | tee -a "${OUTPUT_FILE}"

while true; do
  sample_count=$((sample_count + 1))
  timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  body_file="$(mktemp)"
  http_code="$(curl -sS -m 12 -o "${body_file}" -w "%{http_code}" "${API_BASE_URL}/health" 2>/dev/null || echo "000")"

  health_state="$(jq -r '.status // empty' "${body_file}" 2>/dev/null || true)"
  redis_state="$(jq -r '.checks.redis.status // empty' "${body_file}" 2>/dev/null || true)"
  websocket_state="$(jq -r '.checks.websocket.status // empty' "${body_file}" 2>/dev/null || true)"
  system_state="$(jq -r '.checks.system.status // empty' "${body_file}" 2>/dev/null || true)"
  system_message="$(jq -r '.checks.system.message // empty' "${body_file}" 2>/dev/null || true)"
  cpu_usage="$(jq -r '.checks.system.cpu.usagePercent // empty' "${body_file}" 2>/dev/null || true)"

  printf '%s sample=%s code=%s health=%s redis=%s websocket=%s system=%s cpu=%s msg=\"%s\"\n' \
    "${timestamp}" \
    "${sample_count}" \
    "${http_code}" \
    "${health_state:-n/a}" \
    "${redis_state:-n/a}" \
    "${websocket_state:-n/a}" \
    "${system_state:-n/a}" \
    "${cpu_usage:-n/a}" \
    "${system_message:-n/a}" | tee -a "${OUTPUT_FILE}"

  rm -f "${body_file}"

  if [[ "${MAX_SAMPLES}" != "0" && "${sample_count}" -ge "${MAX_SAMPLES}" ]]; then
    break
  fi

  sleep "${INTERVAL_SECONDS}"
done

echo "# completed samples=${sample_count}" | tee -a "${OUTPUT_FILE}"
