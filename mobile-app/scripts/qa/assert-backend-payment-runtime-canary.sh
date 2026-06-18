#!/usr/bin/env bash
set -euo pipefail

BACKEND_URL="${1:-${BACKEND_URL:-https://api.leaf.app.br}}"
OUTPUT_FILE="${2:-}"
EXPECTED_ENVIRONMENT="${PAYMENT_RUNTIME_EXPECTED_ENVIRONMENT:-sandbox}"
USER_ID="${PAYMENT_RUNTIME_USER_ID:-${PASSENGER_UID:-${FIREBASE_TEST_USER_ID:-}}}"
PHONE="${PAYMENT_RUNTIME_PHONE:-${FIREBASE_TEST_PHONE:-21102938475}}"

check_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[payment-runtime-canary][error] Missing command: $1"
    exit 1
  fi
}

check_cmd curl
check_cmd jq

if [[ -z "$OUTPUT_FILE" ]]; then
  OUTPUT_FILE="$(mktemp)"
  trap 'rm -f "$OUTPUT_FILE"' EXIT
fi

if [[ -z "$USER_ID" && -z "$PHONE" ]]; then
  echo "[payment-runtime-canary][error] Missing PAYMENT_RUNTIME_USER_ID or PAYMENT_RUNTIME_PHONE."
  echo "[payment-runtime-canary][hint] Use the same user/phone that the real smoke flow will use."
  exit 1
fi

request_url="${BACKEND_URL%/}/api/app/runtime-config"
query_args=()
if [[ -n "$USER_ID" ]]; then
  query_args+=("userId=$USER_ID")
fi
if [[ -n "$PHONE" ]]; then
  query_args+=("phone=$PHONE")
fi
if [[ "${#query_args[@]}" -gt 0 ]]; then
  query_string="$(IFS='&'; echo "${query_args[*]}")"
  request_url="${request_url}?${query_string}"
fi

if ! curl -sS --max-time 12 "$request_url" > "$OUTPUT_FILE"; then
  echo "[payment-runtime-canary][error] Runtime config endpoint unreachable: $request_url"
  exit 1
fi

if ! jq -e '.paymentRuntime.effectiveProfile.environment' "$OUTPUT_FILE" >/dev/null 2>&1; then
  echo "[payment-runtime-canary][error] Invalid runtime config response."
  head -n 20 "$OUTPUT_FILE"
  exit 1
fi

effective_environment="$(jq -r '.paymentRuntime.effectiveProfile.environment // "unknown"' "$OUTPUT_FILE")"
profile_id="$(jq -r '.paymentRuntime.effectiveProfile.profileId // "unknown"' "$OUTPUT_FILE")"
context_matched="$(jq -r '.paymentRuntime.effectiveProfile.contextMatched // false' "$OUTPUT_FILE")"
expires_at="$(jq -r '.paymentRuntime.effectiveProfile.expiresAtIso // ""' "$OUTPUT_FILE")"

if [[ "$effective_environment" != "$EXPECTED_ENVIRONMENT" ]]; then
  echo "[payment-runtime-canary][error] Payment runtime is not ${EXPECTED_ENVIRONMENT} for this smoke context."
  echo "[payment-runtime-canary][error] effectiveEnvironment=$effective_environment profileId=$profile_id contextMatched=$context_matched expiresAt=${expires_at:-none}"
  echo "[payment-runtime-canary][hint] Activate a short-lived payment_runtime_profiles sandbox profile or env allowlist for user/phone."
  exit 1
fi

echo "[payment-runtime-canary][pass] effectiveEnvironment=$effective_environment profileId=$profile_id contextMatched=$context_matched expiresAt=${expires_at:-none}"
