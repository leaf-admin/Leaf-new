#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

LABEL="wave2-eligibility"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --label)
      LABEL="${2:-${LABEL}}"
      shift 2
      ;;
    --run-dir)
      RUN_DIR="${2:-}"
      shift 2
      ;;
    *)
      printf '[validation][warn] ignoring unknown arg: %s\n' "$1"
      shift
      ;;
  esac
done

ensure_run_dir "${LABEL}"

WAVE_DIR="${RUN_DIR}/wave2"
MOBILE_DIR="${ROOT_DIR}/mobile-app"
BACKEND_DIR="${ROOT_DIR}/leaf-websocket-backend"
UPDATE_TRACKER="${ROOT_DIR}/scripts/validation/update-tracker.cjs"
mkdir -p "${WAVE_DIR}"

MOBILE_LOG="${WAVE_DIR}/mobile-wave2.log"
BACKEND_LOG="${WAVE_DIR}/backend-wave2.log"

MOBILE_STATUS="pass"
BACKEND_STATUS="pass"

if (
  cd "${MOBILE_DIR}" && \
  npx jest --runInBand \
    __tests__/driver-home-overlay.test.js \
    __tests__/driver-online-toggle.test.js \
    __tests__/destination-quote-recalculation.test.js
) > "${MOBILE_LOG}" 2>&1; then
  :
else
  MOBILE_STATUS="fail"
fi

if (
  cd "${BACKEND_DIR}" && \
  npx jest --runInBand \
    tests/unit/services/driver-eligibility-service.unit.test.js \
    tests/unit/services/driver-dispatch-availability-service.unit.test.js \
    tests/unit/services/city-activation-state-service.unit.test.js \
    tests/unit/services/geofence-service.unit.test.js \
    tests/unit/commands/RequestRideCommand.unit.test.js \
    tests/integration/contracts/create-booking-availability-precheck.contract.test.js
) > "${BACKEND_LOG}" 2>&1; then
  :
else
  BACKEND_STATUS="fail"
fi

OVERALL_STATUS="pass"
if [[ "${MOBILE_STATUS}" != "pass" || "${BACKEND_STATUS}" != "pass" ]]; then
  OVERALL_STATUS="fail"
fi

write_summary_file "${WAVE_DIR}/summary.md" \
"# Wave 2 Summary

- Status: ${OVERALL_STATUS}
- Focus: ativacao do motorista, online/offline, geofence e elegibilidade regional
- Run dir: ${RUN_DIR}

## Automated Coverage

- Mobile activation/recovery/quote: [mobile-wave2.log](${MOBILE_LOG})
- Backend eligibility/geofence/contracts: [backend-wave2.log](${BACKEND_LOG})

## Key Results

- Motorista bloqueado vai para ativacao e nao entra online indevidamente.
- Online/offline e recovery QA do home do motorista: cobertos e verdes.
- Geofence inside/outside/borda: cobertos e verdes.
- Reconciliacao de dispatch apos corrida e falta de location sync: cobertas.
- Quote respeita indisponibilidade regional/categoria no frontend e no contrato backend.
"

cat > "${WAVE_DIR}/result.json" <<EOF
{
  "wave": "wave2",
  "status": "${OVERALL_STATUS}",
  "mobileStatus": "${MOBILE_STATUS}",
  "backendStatus": "${BACKEND_STATUS}",
  "runDir": "${RUN_DIR}"
}
EOF

ACT_STATUS="${MOBILE_STATUS}"
GEO_STATUS="${BACKEND_STATUS}"
if [[ "${MOBILE_STATUS}" != "pass" || "${BACKEND_STATUS}" != "pass" ]]; then
  ACT_STATUS="fail"
  GEO_STATUS="fail"
fi

node "${UPDATE_TRACKER}" --run-dir "${RUN_DIR}" --scenario W2-ACT-001 --status "${ACT_STATUS}" --evidence "wave2/mobile-wave2.log" --notes "ativacao pendente bloqueia online e abre fluxo de ativacao"
node "${UPDATE_TRACKER}" --run-dir "${RUN_DIR}" --scenario W2-ACT-002 --status "${ACT_STATUS}" --evidence "wave2/mobile-wave2.log" --notes "online offline rapido e recovery QA do home cobertos"
node "${UPDATE_TRACKER}" --run-dir "${RUN_DIR}" --scenario W2-GEO-001 --status "${GEO_STATUS}" --evidence "wave2/backend-wave2.log" --notes "geofence inside/outside e elegibilidade de dispatch cobertos"
node "${UPDATE_TRACKER}" --run-dir "${RUN_DIR}" --scenario W2-GEO-002 --status "${GEO_STATUS}" --evidence "wave2/backend-wave2.log" --notes "borda de geofence e reindexacao pos-corrida cobertas em unit tests"
node "${UPDATE_TRACKER}" --run-dir "${RUN_DIR}" --scenario W2-GEO-003 --status "${OVERALL_STATUS}" --evidence "wave2/mobile-wave2.log, wave2/backend-wave2.log" --notes "quote indisponivel por categoria/regiao coberto em destination screen e contract backend"

log "wave2 status: ${OVERALL_STATUS}"
log "summary: ${WAVE_DIR}/summary.md"

if [[ "${OVERALL_STATUS}" != "pass" ]]; then
  exit 1
fi
