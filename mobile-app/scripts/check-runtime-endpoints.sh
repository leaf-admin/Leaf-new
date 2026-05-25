#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC_DIR="$ROOT_DIR/mobile-app/src"

if ! command -v rg >/dev/null 2>&1; then
  echo "[runtime-endpoints][error] rg command not found"
  exit 1
fi

PATTERN='https?://(localhost|127\\.0\\.0\\.1|10\\.0\\.2\\.2)'

MATCHES="$(rg -n "$PATTERN" "$SRC_DIR" \
  --glob '!**/__tests__/**' \
  --glob '!**/config/ApiConfig.cjs' \
  --glob '!**/config/WebSocketConfig.js' \
  --glob '!**/config/NetworkConfig.js' \
  --glob '!**/utils/NetworkUtils.js' \
  --glob '!**/utils/WebSocketTester.js' \
  --glob '!**/utils/NetworkDiagnostics.js' \
  --glob '!**/common-local/config/**' \
  --glob '!**/common-local/redisConfig.js' || true)"

if [[ -n "$MATCHES" ]]; then
  echo "[runtime-endpoints][fail] Found local endpoint hardcodes in runtime code:"
  echo "$MATCHES"
  exit 2
fi

echo "[runtime-endpoints][pass] No local endpoint hardcodes found in runtime code."

LEGACY_PATTERN='/api/stats\b|/api/drivers/location\b|/api/drivers/status\b|/api/update_driver_location\b|/api/nearby_drivers\b|/api/start_trip_tracking\b|/api/update_trip_location\b|/api/end_trip_tracking\b|/api/get_trip_data\b'

LEGACY_MATCHES="$(rg -n "$LEGACY_PATTERN" "$SRC_DIR" \
  --glob '!**/__tests__/**' \
  --glob '!**/examples/**' \
  --glob '!**/docs/**' || true)"

if [[ -n "$LEGACY_MATCHES" ]]; then
  echo "[runtime-endpoints][fail] Found legacy runtime endpoints that are disabled in backend:"
  echo "$LEGACY_MATCHES"
  exit 3
fi

echo "[runtime-endpoints][pass] No disabled legacy endpoints found in runtime code."
