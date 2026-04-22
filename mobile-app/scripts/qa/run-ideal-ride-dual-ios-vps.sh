#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
MOBILE_DIR="${ROOT_DIR}/mobile-app"
PRELIGHT_SCRIPT="${MOBILE_DIR}/scripts/qa/preflight-dual-ios-vps.sh"
PRELIGHT_ENV="${MOBILE_DIR}/test-results/qa-preflight/maestro-runtime-env.sh"
ARTIFACTS_DIR="${MOBILE_DIR}/.maestro/results/ideal_dual_ios_$(date +%Y%m%d_%H%M%S)"
mkdir -p "${ARTIFACTS_DIR}"

# shellcheck source=/dev/null
source "${MOBILE_DIR}/scripts/source-local-build-env.sh"

export PATH="$PATH:$HOME/.maestro/bin"

check_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[ideal][error] Missing command: $1"
    exit 1
  fi
}

check_cmd maestro
check_cmd jq
check_cmd curl
check_cmd xcrun

bash "${PRELIGHT_SCRIPT}"

if [[ ! -f "${PRELIGHT_ENV}" ]]; then
  echo "[ideal][error] Missing preflight env file: ${PRELIGHT_ENV}"
  exit 2
fi

# shellcheck source=/dev/null
source "${PRELIGHT_ENV}"

wait_driver_ready() {
  if [[ -z "${API_BASE_URL:-}" || -z "${DRIVER_UID:-}" || -z "${RUNTIME_ADMIN_TOKEN:-}" ]]; then
    echo "[ideal][warn] Missing runtime status env; falling back to sleep."
    sleep 6
    return 0
  fi

  for attempt in $(seq 1 30); do
    status_json="$(curl -fsS --max-time 15 "${API_BASE_URL}/api/driver-status/${DRIVER_UID}?token=${RUNTIME_ADMIN_TOKEN}" || true)"
    can_receive="$(printf '%s' "${status_json}" | jq -r '.canReceiveRequests // false' 2>/dev/null || echo false)"
    eligible_geo="$(printf '%s' "${status_json}" | jq -r '.details.isEligibleInGeo // false' 2>/dev/null || echo false)"
    if [[ "${can_receive}" == "true" && "${eligible_geo}" == "true" ]]; then
      echo "[ideal] driver dispatch-ready after attempt ${attempt}"
      return 0
    fi
    sleep 2
  done

  echo "[ideal][error] Driver never became dispatch-ready"
  return 1
}

run_flow() {
  local device="$1"
  local flow="$2"
  local name="$3"
  local junit="${ARTIFACTS_DIR}/${name}.xml"
  local log="${ARTIFACTS_DIR}/${name}.log"

  echo "[ideal] Running ${name} on ${device}"
  if maestro test "${flow}" --device "${device}" --format junit --output "${junit}" > "${log}" 2>&1; then
    echo "[ideal] PASS ${name}"
  else
    echo "[ideal] FAIL ${name}"
    cat "${log}"
    exit 3
  fi
}

cd "${MOBILE_DIR}"
run_flow "${DRIVER_UDID}" ".maestro/flows/qa/e2e/ideal/11-driver-login-online-ideal.yaml" "11-driver-login-online-ideal"
wait_driver_ready
run_flow "${PASSENGER_UDID}" ".maestro/flows/qa/e2e/ideal/12-passenger-login-ideal.yaml" "12-passenger-login-ideal"
run_flow "${PASSENGER_UDID}" ".maestro/flows/qa/e2e/ideal/13-passenger-request-ideal.yaml" "13-passenger-request-ideal"
run_flow "${DRIVER_UDID}" ".maestro/flows/qa/e2e/ideal/14-driver-complete-ideal.yaml" "14-driver-complete-ideal"
run_flow "${PASSENGER_UDID}" ".maestro/flows/qa/e2e/ideal/15-passenger-receipt-rating-ideal.yaml" "15-passenger-receipt-rating-ideal"

echo "[ideal] Done. Artifacts: ${ARTIFACTS_DIR}"
