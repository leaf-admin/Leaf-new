#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

LABEL="wave1-auth-kyc"
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

WAVE_DIR="${RUN_DIR}/wave1"
MOBILE_DIR="${ROOT_DIR}/mobile-app"
BACKEND_DIR="${ROOT_DIR}/leaf-websocket-backend"
UPDATE_TRACKER="${ROOT_DIR}/scripts/validation/update-tracker.cjs"
mkdir -p "${WAVE_DIR}"

MOBILE_LOG="${WAVE_DIR}/mobile-wave1.log"
BACKEND_LOG="${WAVE_DIR}/backend-wave1.log"

MOBILE_STATUS="pass"
BACKEND_STATUS="pass"

if (
  cd "${MOBILE_DIR}" && \
  npx jest --runInBand \
    __tests__/auth-flow.recovery.test.js \
    __tests__/user-database-service.onboarding.test.js \
    __tests__/otp-step.auth.test.js \
    __tests__/document-step.kyc.test.js \
    __tests__/kyc-service.liveness.test.js
) > "${MOBILE_LOG}" 2>&1; then
  :
else
  MOBILE_STATUS="fail"
fi

if (
  cd "${BACKEND_DIR}" && \
  npx jest --runInBand \
    tests/unit/services/kyc-policy-service.unit.test.js \
    tests/unit/services/kyc-service.unit.test.js
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
"# Wave 1 Summary

- Status: ${OVERALL_STATUS}
- Focus: cadastro, OTP, onboarding recovery, documentos, OCR e KYC
- Run dir: ${RUN_DIR}

## Automated Coverage

- Mobile auth/docs/KYC: [mobile-wave1.log](${MOBILE_LOG})
- Backend KYC services/policy: [backend-wave1.log](${BACKEND_LOG})

## Key Results

- Cadastro novo e payload consistente do onboarding: helper + payload tests.
- OTP inválido, expirado e reutilizado: cobertos e verdes.
- Recovery do onboarding e reidratação de dados: cobertos e verdes.
- Upload/leitura de CNH/CRLV/PDF e OCR de documentos: cobertos e verdes.
- Happy path de liveness/KYC e governança de bloqueio por mismatch: cobertos e verdes.
"

cat > "${WAVE_DIR}/result.json" <<EOF
{
  "wave": "wave1",
  "status": "${OVERALL_STATUS}",
  "mobileStatus": "${MOBILE_STATUS}",
  "backendStatus": "${BACKEND_STATUS}",
  "runDir": "${RUN_DIR}"
}
EOF

REG_STATUS="${MOBILE_STATUS}"
DOC_STATUS="${MOBILE_STATUS}"
KYC_STATUS="${MOBILE_STATUS}"
if [[ "${BACKEND_STATUS}" != "pass" ]]; then
  KYC_STATUS="fail"
fi

node "${UPDATE_TRACKER}" --run-dir "${RUN_DIR}" --scenario W1-REG-001 --status "${REG_STATUS}" --evidence "wave1/mobile-wave1.log" --notes "cadastro novo e payload consistente cobertos por authFlowRecovery e userDatabaseService"
node "${UPDATE_TRACKER}" --run-dir "${RUN_DIR}" --scenario W1-REG-002 --status "${REG_STATUS}" --evidence "wave1/mobile-wave1.log" --notes "usuario existente persistido no recovery; OTP invalido, expirado e reutilizado cobertos"
node "${UPDATE_TRACKER}" --run-dir "${RUN_DIR}" --scenario W1-REG-003 --status "${REG_STATUS}" --evidence "wave1/mobile-wave1.log" --notes "persistencia e recovery do onboarding cobertos por helpers de reidratacao"
node "${UPDATE_TRACKER}" --run-dir "${RUN_DIR}" --scenario W1-DOC-001 --status "${DOC_STATUS}" --evidence "wave1/mobile-wave1.log" --notes "upload e leitura de CNH cobertos por DocumentStep"
node "${UPDATE_TRACKER}" --run-dir "${RUN_DIR}" --scenario W1-DOC-002 --status "${DOC_STATUS}" --evidence "wave1/mobile-wave1.log" --notes "upload e leitura de CRLV/PDF cobertos por DocumentStep"
node "${UPDATE_TRACKER}" --run-dir "${RUN_DIR}" --scenario W1-DOC-003 --status "${DOC_STATUS}" --evidence "wave1/mobile-wave1.log" --notes "normalizacao OCR e rejeicao explicita cobertas em fluxo mobile"
node "${UPDATE_TRACKER}" --run-dir "${RUN_DIR}" --scenario W1-KYC-001 --status "${KYC_STATUS}" --evidence "wave1/mobile-wave1.log, wave1/backend-wave1.log" --notes "liveness provider, verifyDriver happy path e policy backend verdes"
node "${UPDATE_TRACKER}" --run-dir "${RUN_DIR}" --scenario W1-KYC-002 --status "${KYC_STATUS}" --evidence "wave1/mobile-wave1.log, wave1/backend-wave1.log" --notes "mismatch, manual review gate e retry/policy cobertos"
node "${UPDATE_TRACKER}" --run-dir "${RUN_DIR}" --scenario W1-KYC-003 --status "${KYC_STATUS}" --evidence "wave1/backend-wave1.log" --notes "KYC governa dispatch/online via markDriverForPhotoMismatch e bloqueio de elegibilidade"

log "wave1 status: ${OVERALL_STATUS}"
log "summary: ${WAVE_DIR}/summary.md"

if [[ "${OVERALL_STATUS}" != "pass" ]]; then
  exit 1
fi
