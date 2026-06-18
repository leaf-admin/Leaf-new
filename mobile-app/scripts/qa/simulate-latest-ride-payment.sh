#!/usr/bin/env bash

set -euo pipefail

API_BASE_URL="${API_BASE_URL:-https://api.leaf.app.br}"
WATCH_TIMEOUT_SEC="${WATCH_TIMEOUT_SEC:-180}"
POLL_INTERVAL_SEC="${POLL_INTERVAL_SEC:-2}"
PASSENGER_UID_FILTER="${PASSENGER_UID_FILTER:-}"
LAST_CHARGE_ID="${LAST_CHARGE_ID:-}"
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

deadline=$(( $(date +%s) + WATCH_TIMEOUT_SEC ))
started_at_iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "[simulate-latest-ride-payment] watching ride charges on ${API_BASE_URL}"

while [[ $(date +%s) -lt ${deadline} ]]; do
  charges_json="$(
    curl -fsS \
      -H "authorization: Bearer ${ADMIN_TOKEN}" \
      "${API_BASE_URL}/api/woovi/list-charges?limit=200" || true
  )"

  latest_charge_json="$(
    jq -c --arg passenger "${PASSENGER_UID_FILTER}" --arg last "${LAST_CHARGE_ID}" --arg startedAt "${started_at_iso}" '
      (
        .data.charges // .charges // .data // []
      )
      | map(
          . as $c
          | {
              identifier: ($c.identifier // $c.transactionID // ""),
              createdAt: ($c.createdAt // ""),
              correlationID: ($c.correlationID // ""),
              value: ($c.value // $c.amount // 0),
              status: ($c.status // ""),
              rideId: (
                ($c.additionalInfo // [])
                | map(select(.key == "ride_id") | .value)
                | .[0] // ""
              ),
              passengerId: (
                ($c.additionalInfo // [])
                | map(select(.key == "passenger_id") | .value)
                | .[0] // ""
              ),
              paymentType: (
                ($c.additionalInfo // [])
                | map(select(.key == "payment_type") | .value)
                | .[0] // "advance_payment"
              ),
              paymentIntentId: (
                ($c.additionalInfo // [])
                | map(select(.key == "payment_intent_id" or .key == "paymentIntentId") | .value)
                | .[0] // ""
              ),
              hasRideService: (
                ($c.additionalInfo // [])
                | any(.key == "service" and .value == "ride_sharing")
              )
            }
        )
      | map(select(.hasRideService == true))
      | map(select(.status == "ACTIVE"))
      | map(select(.identifier != ""))
      | map(select(.identifier != $last))
      | map(select(.createdAt >= $startedAt))
      | map(select(($passenger == "") or (.passengerId == $passenger)))
      | sort_by(.createdAt)
      | reverse
      | .[0] // empty
    ' <<< "${charges_json}"
  )"

  if [[ -n "${latest_charge_json}" ]]; then
    charge_id="$(jq -r '.identifier' <<< "${latest_charge_json}")"
    correlation_id="$(jq -r '.correlationID' <<< "${latest_charge_json}")"
    ride_id="$(jq -r '.rideId' <<< "${latest_charge_json}")"
    passenger_id="$(jq -r '.passengerId' <<< "${latest_charge_json}")"
    amount_cents="$(jq -r '.value' <<< "${latest_charge_json}")"
    payment_type="$(jq -r '.paymentType' <<< "${latest_charge_json}")"
    payment_intent_id="$(jq -r '.paymentIntentId' <<< "${latest_charge_json}")"

    if [[ -z "${ride_id}" || -z "${passenger_id}" || -z "${payment_intent_id}" ]]; then
      echo "[simulate-latest-ride-payment] latest charge lacks ride/passenger/payment intent metadata; skipping ${charge_id}" >&2
      LAST_CHARGE_ID="${charge_id}"
      sleep "${POLL_INTERVAL_SEC}"
      continue
    fi

    echo "[simulate-latest-ride-payment] confirming charge ${charge_id} ride=${ride_id} passenger=${passenger_id}"

    payload="$(
      jq -n \
        --arg chargeId "${charge_id}" \
        --arg correlationID "${correlation_id}" \
        --arg rideId "${ride_id}" \
        --arg passengerId "${passenger_id}" \
        --arg paymentType "${payment_type}" \
        --arg paymentIntentId "${payment_intent_id}" \
        --arg paidAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        --argjson value "${amount_cents}" \
        '{
          event: "OPENPIX:CHARGE_COMPLETED",
          charge: {
            identifier: $chargeId,
            transactionID: $chargeId,
            correlationID: $correlationID,
            status: "COMPLETED",
            value: $value,
            paidAt: $paidAt,
            additionalInfo: [
              { key: "passenger_id", value: $passengerId },
              { key: "ride_id", value: $rideId },
              { key: "payment_type", value: $paymentType },
              { key: "payment_intent_id", value: $paymentIntentId },
              { key: "service", value: "ride_sharing" }
            ]
          },
          pix: {
            status: "COMPLETED"
          }
        }'
    )"

    response_json="$(
      curl -fsS -X POST "${API_BASE_URL}/api/woovi/test-webhook" \
      -H "authorization: Bearer ${ADMIN_TOKEN}" \
      -H 'content-type: application/json' \
      -d "${payload}"
    )"

    if [[ -n "${PAYMENT_EVIDENCE_PATH}" ]]; then
      mkdir -p "$(dirname "${PAYMENT_EVIDENCE_PATH}")"
      jq -n \
        --arg confirmedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        --arg apiBaseUrl "${API_BASE_URL}" \
        --argjson charge "${latest_charge_json}" \
        --argjson response "${response_json}" \
        '{
          confirmedAt: $confirmedAt,
          apiBaseUrl: $apiBaseUrl,
          charge: $charge,
          response: $response
        }' > "${PAYMENT_EVIDENCE_PATH}"
    fi

    echo "[simulate-latest-ride-payment] webhook sent for ${charge_id}"
    exit 0
  fi

  sleep "${POLL_INTERVAL_SEC}"
done

echo "[simulate-latest-ride-payment] timeout waiting for new ACTIVE ride charge" >&2
exit 1
