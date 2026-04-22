#!/usr/bin/env bash

set -euo pipefail

API_BASE_URL="${API_BASE_URL:-https://api.147.182.204.181.sslip.io}"
WATCH_TIMEOUT_SEC="${WATCH_TIMEOUT_SEC:-180}"
POLL_INTERVAL_SEC="${POLL_INTERVAL_SEC:-2}"
PASSENGER_UID_FILTER="${PASSENGER_UID_FILTER:-}"
LAST_CHARGE_ID="${LAST_CHARGE_ID:-}"

deadline=$(( $(date +%s) + WATCH_TIMEOUT_SEC ))
started_at_iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "[simulate-latest-ride-payment] watching ride charges on ${API_BASE_URL}"

while [[ $(date +%s) -lt ${deadline} ]]; do
  charges_json="$(curl -sS "${API_BASE_URL}/api/woovi/list-charges?limit=200" || true)"

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

    echo "[simulate-latest-ride-payment] confirming charge ${charge_id} ride=${ride_id} passenger=${passenger_id}"

    payload="$(
      jq -n \
        --arg chargeId "${charge_id}" \
        --arg correlationID "${correlation_id}" \
        --arg rideId "${ride_id}" \
        --arg passengerId "${passenger_id}" \
        --arg paymentType "${payment_type}" \
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
              { key: "service", value: "ride_sharing" }
            ]
          },
          pix: {
            status: "COMPLETED"
          }
        }'
    )"

    curl -sS -X POST "${API_BASE_URL}/api/woovi/test-webhook" \
      -H 'content-type: application/json' \
      -d "${payload}" >/dev/null

    echo "[simulate-latest-ride-payment] webhook sent for ${charge_id}"
    exit 0
  fi

  sleep "${POLL_INTERVAL_SEC}"
done

echo "[simulate-latest-ride-payment] timeout waiting for new ACTIVE ride charge" >&2
exit 1
