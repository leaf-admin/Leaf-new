#!/usr/bin/env bash

set -euo pipefail

API_BASE_URL="${API_BASE_URL:-https://api.leaf.app.br}"
WATCH_TIMEOUT_SEC="${WATCH_TIMEOUT_SEC:-180}"
POLL_INTERVAL_SEC="${POLL_INTERVAL_SEC:-2}"
PASSENGER_UID_FILTER="${PASSENGER_UID_FILTER:-}"
PAYMENT_INTENT_ID="${PAYMENT_INTENT_ID:-}"
PAYMENT_EVIDENCE_PATH="${PAYMENT_EVIDENCE_PATH:-}"
DASHBOARD_SESSION_PATH="${DASHBOARD_SESSION_PATH:-${HOME}/.leaf/dashboard-session.json}"
ADMIN_ENV_PATH="${ADMIN_ENV_PATH:-${HOME}/.leaf/dashboard-admin.env}"

load_admin_token() {
  local token="${LEAF_ADMIN_ACCESS_TOKEN:-${DASHBOARD_ADMIN_ACCESS_TOKEN:-${ADMIN_BEARER_TOKEN:-${ADMIN_JWT:-}}}}"

  if [[ -z "${token}" && -f "${ADMIN_ENV_PATH}" ]]; then
    token="$(
      awk -F= '
        /^[[:space:]]*(export[[:space:]]+)?(LEAF_ADMIN_ACCESS_TOKEN|DASHBOARD_ADMIN_ACCESS_TOKEN|ADMIN_BEARER_TOKEN|ADMIN_JWT)=/ {
          value=$2
          sub(/^[[:space:]]*["'\''"]?/, "", value)
          sub(/["'\''"]?[[:space:]]*$/, "", value)
          print value
          exit
        }
      ' "${ADMIN_ENV_PATH}" 2>/dev/null || true
    )"
  fi

  if [[ -z "${token}" && -f "${DASHBOARD_SESSION_PATH}" ]]; then
    token="$(
      jq -r '
        .accessToken //
        .token //
        .adminAccessToken //
        .leaf_admin_access_token //
        .session.accessToken //
        .session.token //
        empty
      ' "${DASHBOARD_SESSION_PATH}" 2>/dev/null || true
    )"
  fi

  printf '%s' "${token}"
}

ADMIN_TOKEN="$(load_admin_token)"
if [[ -z "${ADMIN_TOKEN}" ]]; then
  echo "[simulate-latest-ride-payment] missing admin token. Set LEAF_ADMIN_ACCESS_TOKEN or DASHBOARD_ADMIN_ACCESS_TOKEN." >&2
  exit 2
fi

if [[ -z "${PASSENGER_UID_FILTER}" || -z "${PAYMENT_INTENT_ID}" ]]; then
  echo "[simulate-latest-ride-payment] PASSENGER_UID_FILTER and PAYMENT_INTENT_ID are required." >&2
  echo "[simulate-latest-ride-payment] Refusing ambiguous lookup by passenger." >&2
  exit 2
fi

deadline=$(( $(date +%s) + WATCH_TIMEOUT_SEC ))

echo "[simulate-latest-ride-payment] confirming exact sandbox payment intent on ${API_BASE_URL}"

while [[ $(date +%s) -lt ${deadline} ]]; do
  response_with_status="$(
    curl -sS -w $'\n%{http_code}' -X POST "${API_BASE_URL}/api/woovi/test-confirm-sandbox-payment" \
      -H "authorization: Bearer ${ADMIN_TOKEN}" \
      -H 'content-type: application/json' \
      -d "$(jq -n \
        --arg passengerId "${PASSENGER_UID_FILTER}" \
        --arg paymentIntentId "${PAYMENT_INTENT_ID}" \
        '{ passengerId: $passengerId, paymentIntentId: $paymentIntentId }')" || true
  )"
  http_status="${response_with_status##*$'\n'}"
  response_json="${response_with_status%$'\n'*}"

  if [[ "${http_status}" == "401" || "${http_status}" == "403" ]]; then
    code="$(jq -r '.code // .error // "AUTHENTICATION_FAILED"' <<< "${response_json}" 2>/dev/null || true)"
    echo "[simulate-latest-ride-payment] authentication failed: ${code}" >&2
    exit 3
  fi

  if [[ "$(jq -r '.success // false' <<< "${response_json}" 2>/dev/null || true)" == "true" ]]; then
    charge_id="$(jq -r '.chargeId' <<< "${response_json}")"
    ride_id="$(jq -r '.rideId' <<< "${response_json}")"
    passenger_id="${PASSENGER_UID_FILTER}"
    amount_cents="$(jq -r '.amountInCents' <<< "${response_json}")"
    payment_intent_id="$(jq -r '.paymentIntentId' <<< "${response_json}")"

    echo "[simulate-latest-ride-payment] confirmed sandbox charge ${charge_id} ride=${ride_id} passenger=${passenger_id}"

    if [[ -n "${PAYMENT_EVIDENCE_PATH}" ]]; then
      mkdir -p "$(dirname "${PAYMENT_EVIDENCE_PATH}")"
      jq -n \
        --arg confirmedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        --arg apiBaseUrl "${API_BASE_URL}" \
        --arg chargeId "${charge_id}" \
        --arg rideId "${ride_id}" \
        --arg passengerId "${passenger_id}" \
        --arg paymentIntentId "${payment_intent_id}" \
        --argjson value "${amount_cents}" \
        --argjson response "${response_json}" \
        '{
          confirmedAt: $confirmedAt,
          apiBaseUrl: $apiBaseUrl,
          charge: {
            identifier: $chargeId,
            rideId: $rideId,
            passengerId: $passengerId,
            paymentIntentId: $paymentIntentId,
            value: $value,
            environment: "sandbox"
          },
          response: $response
        }' > "${PAYMENT_EVIDENCE_PATH}"
    fi

    exit 0
  fi

  sleep "${POLL_INTERVAL_SEC}"
done

echo "[simulate-latest-ride-payment] timeout waiting for new ACTIVE ride charge" >&2
exit 1
