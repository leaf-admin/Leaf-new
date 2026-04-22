#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
API_BASE_URL="${API_BASE_URL:-${LEAF_API_BASE_URL:-https://api.147.182.204.181.sslip.io}}"
HEALTH_URL="${HEALTH_URL:-${LEAF_HEALTH_URL:-${API_BASE_URL}/health}}"
PRECHECK_LOG="$(mktemp)"
DEEP_LOG="$(mktemp)"

echo "[pilot-deep] running pilot preflight..."
if LEAF_HEALTH_URL="${HEALTH_URL}" bash "${ROOT_DIR}/scripts/validation/run-pilot-controlled-preflight.sh" | tee "${PRECHECK_LOG}"; then
  :
else
  echo "[pilot-deep] preflight failed"
  exit 1
fi

echo
echo "[pilot-deep] running VPS healthcheck..."
if AUTH_TOKEN="${AUTH_TOKEN:-${LEAF_ADMIN_BEARER_TOKEN:-}}" bash "${ROOT_DIR}/scripts/healthcheck-vps.sh" "${API_BASE_URL}" | tee "${DEEP_LOG}"; then
  echo "[pilot-deep] deep check PASS"
  exit 0
fi

echo "[pilot-deep] deep check FAIL"
exit 1
