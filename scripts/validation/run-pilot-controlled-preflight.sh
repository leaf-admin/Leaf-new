#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TRACKER_PATH="${ROOT_DIR}/reports/validation-runs/20260403_121509_wave1-wave4-exec/tracker.md"
MOBILE_ENV_PATH="${ROOT_DIR}/mobile-app/.env.pilot.example"
BACKEND_ENV_PATH="${ROOT_DIR}/leaf-websocket-backend/config/pilot-controlled.env.example"
HEALTH_URL="${HEALTH_URL:-${LEAF_HEALTH_URL:-}}"

ARGS=(
  --tracker "${TRACKER_PATH}"
  --mobile-env "${MOBILE_ENV_PATH}"
  --backend-env "${BACKEND_ENV_PATH}"
)

if [[ -n "${HEALTH_URL}" ]]; then
  ARGS+=(--health-url "${HEALTH_URL}")
fi

node "${ROOT_DIR}/scripts/validation/run-pilot-controlled-preflight.cjs" "${ARGS[@]}" "$@"
