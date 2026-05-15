#!/usr/bin/env bash
set -euo pipefail

BACKEND_URL="${1:-${BACKEND_URL:-https://api.leaf.app.br}}"
OUTPUT_FILE="${2:-}"

check_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[backend-real-sandbox][error] Missing command: $1"
    exit 1
  fi
}

check_cmd curl
check_cmd jq

if [[ -z "$OUTPUT_FILE" ]]; then
  OUTPUT_FILE="$(mktemp)"
  trap 'rm -f "$OUTPUT_FILE"' EXIT
fi

if ! curl -sS --max-time 12 "$BACKEND_URL/health/runtime-flags" > "$OUTPUT_FILE"; then
  echo "[backend-real-sandbox][error] Runtime flags endpoint unreachable: $BACKEND_URL/health/runtime-flags"
  exit 1
fi

if ! jq -e '.realSandbox.ready' "$OUTPUT_FILE" >/dev/null 2>&1; then
  echo "[backend-real-sandbox][error] Invalid runtime flags response (backend may be outdated)."
  head -n 20 "$OUTPUT_FILE"
  exit 1
fi

if [[ "$(jq -r '.realSandbox.ready // false' "$OUTPUT_FILE")" != "true" ]]; then
  echo "[backend-real-sandbox][error] Backend is not ready for strict real-sandbox."
  echo "[backend-real-sandbox][error] Blockers:"
  jq -r '.realSandbox.blockers[]? // "unknown blocker"' "$OUTPUT_FILE"
  exit 1
fi

echo "[backend-real-sandbox][pass] runtime is strict and ready."
