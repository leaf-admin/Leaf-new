#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

LABEL="wave9-production-readiness"
RUN_LOCAL_GATES="${RUN_LOCAL_GATES:-true}"
RUN_EXTENDED_LOCAL_GATES="${RUN_EXTENDED_LOCAL_GATES:-true}"
RUN_L2_SMOKE="${RUN_L2_SMOKE:-false}"
EXPLICIT_L2_APPROVAL="${EXPLICIT_L2_APPROVAL:-false}"
KYC_PROVIDER_EVIDENCE_PATH="${KYC_PROVIDER_EVIDENCE_PATH:-}"
FCM_DELIVERY_EVIDENCE_PATH="${FCM_DELIVERY_EVIDENCE_PATH:-}"

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

WAVE_DIR="${RUN_DIR}/wave9"
EVIDENCE_DIR="${WAVE_DIR}/evidence"
UPDATE_TRACKER="${ROOT_DIR}/scripts/validation/update-tracker.cjs"
CONFIG_REPORT="${EVIDENCE_DIR}/runtime-config.json"
mkdir -p "${EVIDENCE_DIR}"

run_and_capture() {
  local name="$1"
  shift
  local log_path="${EVIDENCE_DIR}/${name}.log"

  log "wave9 ${name}"
  if "$@" > "${log_path}" 2>&1; then
    printf 'pass\n'
    return 0
  fi

  printf 'fail\n'
  return 1
}

json_field() {
  local field="$1"
  node -e "const fs=require('fs'); const p=process.argv[1]; const f=process.argv[2].split('.'); let v=JSON.parse(fs.readFileSync(p,'utf8')); for (const k of f) v = v && v[k]; console.log(v === undefined ? '' : String(v));" "${CONFIG_REPORT}" "${field}"
}

copy_evidence_if_present() {
  local source_path="$1"
  [[ -n "${source_path}" && -f "${source_path}" ]] || return 0
  cp "${source_path}" "${EVIDENCE_DIR}/"
}

CORE_STATUS="pass"
CORE_NOTES="baseline local gates"
RUNTIME_CONFIG_STATUS="pass"

mark_core_failed() {
  CORE_STATUS="fail"
}

mark_core_blocked() {
  if [[ "${CORE_STATUS}" == "pass" ]]; then
    CORE_STATUS="blocked"
  fi
}

classify_runtime_config_result() {
  local config_path="$1"
  node - "${config_path}" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
try {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const blockers = Array.isArray(data?.summary?.blockers) ? data.summary.blockers : [];
  if (
    blockers.length > 0 &&
    blockers.every((blocker) => /Política financeira ativa sem aprovação explícita/.test(String(blocker || '')))
  ) {
    console.log('financial_policy_approval_blocked');
    process.exit(0);
  }
  console.log(blockers.length > 0 ? 'failed' : 'unknown_failure');
} catch (_error) {
  console.log('invalid_report');
}
NODE
}

if [[ "${RUN_LOCAL_GATES}" == "true" ]]; then
  run_and_capture git-diff-check git -C "${ROOT_DIR}" diff --check || mark_core_failed
  run_and_capture governance-check npm run governance:check --prefix "${ROOT_DIR}" || mark_core_failed
  run_and_capture tracked-secret-scan node "${ROOT_DIR}/scripts/maintenance/security/scan-secrets.cjs" --tracked-only || mark_core_failed
  run_and_capture hardcoded-secret-guard bash "${ROOT_DIR}/leaf-websocket-backend/scripts/tests/assert-no-hardcoded-secrets.sh" || mark_core_failed
  run_and_capture mobile-production-guards npm --prefix "${ROOT_DIR}/mobile-app" run qa:production-guards || mark_core_failed
  run_and_capture backend-route-guards npm --prefix "${ROOT_DIR}/leaf-websocket-backend" run test:route-guards || mark_core_failed
  run_and_capture backend-no-active-vps-runtime npm --prefix "${ROOT_DIR}/leaf-websocket-backend" run check:no-active-vps-runtime || mark_core_failed
  if [[ "${RUN_EXTENDED_LOCAL_GATES}" == "true" ]]; then
    CORE_NOTES="baseline local gates plus full mobile/backend unit gates"
    run_and_capture mobile-full-unit npm --prefix "${ROOT_DIR}/mobile-app" run test:unit -- --runInBand || mark_core_failed
    run_and_capture backend-full-unit npm --prefix "${ROOT_DIR}/leaf-websocket-backend" run test:unit -- --runInBand || mark_core_failed
  fi
  run_and_capture dashboard-backoffice npm --prefix "${ROOT_DIR}/leaf-dashboard-js" run qa:backoffice || mark_core_failed

  log "wave9 runtime-config"
  if node "${ROOT_DIR}/leaf-websocket-backend/scripts/deploy/validate-runtime-config.js" > "${CONFIG_REPORT}" 2> "${EVIDENCE_DIR}/runtime-config.stderr.log"; then
    RUNTIME_CONFIG_STATUS="pass"
  else
    RUNTIME_CONFIG_STATUS="$(classify_runtime_config_result "${CONFIG_REPORT}")"
    if [[ "${RUNTIME_CONFIG_STATUS}" == "financial_policy_approval_blocked" ]]; then
      mark_core_blocked
      CORE_NOTES="${CORE_NOTES}; production runtime blocked pending approved financial policy reference"
    else
      mark_core_failed
      CORE_NOTES="${CORE_NOTES}; runtime config failed"
    fi
  fi
else
  CORE_STATUS="blocked"
  CORE_NOTES="local gates skipped by RUN_LOCAL_GATES=false"
  RUNTIME_CONFIG_STATUS="blocked"
fi

FIREBASE_CONFIGURED="unknown"
MAPS_CONFIGURED="unknown"
KYC_ENABLED="false"
FCM_CONFIGURED="false"
if [[ ! -f "${CONFIG_REPORT}" ]]; then
  cat > "${CONFIG_REPORT}" <<EOF
{
  "ok": false,
  "skipped": true,
  "reason": "RUN_LOCAL_GATES=false or runtime config was not collected",
  "diagnostics": {
    "firebase": { "configured": "unknown" },
    "maps": { "keyConfigured": "unknown" },
    "biometricReadiness": { "enabled": false },
    "push": { "fcmConfigured": false }
  }
}
EOF
fi
if [[ -f "${CONFIG_REPORT}" ]]; then
  FIREBASE_CONFIGURED="$(json_field diagnostics.firebase.configured || true)"
  MAPS_CONFIGURED="$(json_field diagnostics.maps.keyConfigured || true)"
  KYC_ENABLED="$(json_field diagnostics.biometricReadiness.enabled || true)"
  FCM_CONFIGURED="$(json_field diagnostics.push.fcmConfigured || true)"
fi

if [[ "${RUN_LOCAL_GATES}" == "true" && ( "${FIREBASE_CONFIGURED}" != "true" || "${MAPS_CONFIGURED}" != "true" ) ]]; then
  mark_core_failed
  CORE_NOTES="baseline local gates; Firebase/Google config is not clean"
fi

L2_STATUS="blocked"
L2_NOTES="requires EXPLICIT_L2_APPROVAL=true and RUN_L2_SMOKE=true"
if [[ "${RUN_L2_SMOKE}" == "true" && "${EXPLICIT_L2_APPROVAL}" == "true" ]]; then
  if bash "${ROOT_DIR}/mobile-app/scripts/qa/prepare-real-smoke-env.sh" > "${EVIDENCE_DIR}/l2-preflight.log" 2>&1 && \
     bash "${ROOT_DIR}/mobile-app/scripts/qa/run-core-audit-suite.sh" > "${EVIDENCE_DIR}/l2-core-audit.log" 2>&1; then
    L2_STATUS="pass"
    L2_NOTES="authorized Android L2 completed"
  else
    L2_STATUS="fail"
    L2_NOTES="authorized Android L2 failed; inspect evidence logs"
  fi
fi

FIN_STATUS="${L2_STATUS}"
FIN_NOTES="same rideId reconciliation must be captured by authorized L2 artifacts"
SOCKET_STATUS="${L2_STATUS}"
SOCKET_NOTES="Socket.IO lifecycle replay must be captured by authorized L2 artifacts"

KYC_STATUS="blocked"
KYC_NOTES="requires provider-backed KYC evidence and KYC_PRODUCTION_BIOMETRICS_ENABLED=true"
if [[ "${KYC_ENABLED}" == "true" && -n "${KYC_PROVIDER_EVIDENCE_PATH}" && -f "${KYC_PROVIDER_EVIDENCE_PATH}" ]]; then
  KYC_STATUS="pass"
  KYC_NOTES="provider-backed KYC evidence attached"
  copy_evidence_if_present "${KYC_PROVIDER_EVIDENCE_PATH}"
fi

FCM_STATUS="blocked"
FCM_NOTES="requires FCM configured and real delivery evidence"
if [[ "${FCM_CONFIGURED}" == "true" && -n "${FCM_DELIVERY_EVIDENCE_PATH}" && -f "${FCM_DELIVERY_EVIDENCE_PATH}" ]]; then
  FCM_STATUS="pass"
  FCM_NOTES="FCM delivery evidence attached"
  copy_evidence_if_present "${FCM_DELIVERY_EVIDENCE_PATH}"
fi

OVERALL_STATUS="pass"
if [[ "${CORE_STATUS}" == "fail" || "${L2_STATUS}" == "fail" || "${FIN_STATUS}" == "fail" || "${SOCKET_STATUS}" == "fail" || "${KYC_STATUS}" == "fail" || "${FCM_STATUS}" == "fail" ]]; then
  OVERALL_STATUS="fail"
elif [[ "${CORE_STATUS}" == "blocked" || "${L2_STATUS}" == "blocked" || "${FIN_STATUS}" == "blocked" || "${SOCKET_STATUS}" == "blocked" || "${KYC_STATUS}" == "blocked" || "${FCM_STATUS}" == "blocked" ]]; then
  OVERALL_STATUS="blocked"
fi

write_summary_file "${WAVE_DIR}/summary.md" \
"# Wave 9 Summary

- Status: ${OVERALL_STATUS}
- Core local gates: ${CORE_STATUS}
- Runtime config: ${RUNTIME_CONFIG_STATUS}
- L2 Android smoke: ${L2_STATUS}
- Financial reconciliation: ${FIN_STATUS}
- Socket.IO replay: ${SOCKET_STATUS}
- KYC provider evidence: ${KYC_STATUS}
- FCM delivery evidence: ${FCM_STATUS}
- Run dir: ${RUN_DIR}

## Runtime Config

- Firebase configured: ${FIREBASE_CONFIGURED}
- Google Maps configured: ${MAPS_CONFIGURED}
- KYC production biometrics enabled: ${KYC_ENABLED}
- FCM configured: ${FCM_CONFIGURED}

## Evidence

- Runtime config: [runtime-config.json](evidence/runtime-config.json)
- Evidence dir: \`${EVIDENCE_DIR}\`
- Production readiness audit: [PRODUCTION_READINESS_CORE_AUDIT_2026-06-21.md](${ROOT_DIR}/docs/validation/PRODUCTION_READINESS_CORE_AUDIT_2026-06-21.md)
"

cat > "${WAVE_DIR}/result.json" <<EOF
{
  "wave": "wave9",
  "status": "${OVERALL_STATUS}",
  "coreStatus": "${CORE_STATUS}",
  "runtimeConfigStatus": "${RUNTIME_CONFIG_STATUS}",
  "l2Status": "${L2_STATUS}",
  "financialStatus": "${FIN_STATUS}",
  "socketStatus": "${SOCKET_STATUS}",
  "kycStatus": "${KYC_STATUS}",
  "fcmStatus": "${FCM_STATUS}",
  "firebaseConfigured": "${FIREBASE_CONFIGURED}",
  "mapsConfigured": "${MAPS_CONFIGURED}",
  "kycProductionBiometricsEnabled": "${KYC_ENABLED}",
  "fcmConfigured": "${FCM_CONFIGURED}",
  "runDir": "${RUN_DIR}",
  "evidenceDir": "${EVIDENCE_DIR}"
}
EOF

node "${UPDATE_TRACKER}" --run-dir "${RUN_DIR}" --scenario W9-CORE-001 --status "${CORE_STATUS}" --evidence "wave9/summary.md" --notes "${CORE_NOTES}; RuntimeConfig=${RUNTIME_CONFIG_STATUS}, Firebase=${FIREBASE_CONFIGURED}, Google=${MAPS_CONFIGURED}, KYC=${KYC_ENABLED}, FCM=${FCM_CONFIGURED}"
node "${UPDATE_TRACKER}" --run-dir "${RUN_DIR}" --scenario W9-L2-001 --status "${L2_STATUS}" --evidence "wave9/evidence" --notes "${L2_NOTES}"
node "${UPDATE_TRACKER}" --run-dir "${RUN_DIR}" --scenario W9-FIN-001 --status "${FIN_STATUS}" --evidence "wave9/evidence" --notes "${FIN_NOTES}"
node "${UPDATE_TRACKER}" --run-dir "${RUN_DIR}" --scenario W9-SOCKET-001 --status "${SOCKET_STATUS}" --evidence "wave9/evidence" --notes "${SOCKET_NOTES}"
node "${UPDATE_TRACKER}" --run-dir "${RUN_DIR}" --scenario W9-KYC-001 --status "${KYC_STATUS}" --evidence "wave9/evidence" --notes "${KYC_NOTES}"
node "${UPDATE_TRACKER}" --run-dir "${RUN_DIR}" --scenario W9-FCM-001 --status "${FCM_STATUS}" --evidence "wave9/evidence" --notes "${FCM_NOTES}"

log "wave9 status: ${OVERALL_STATUS}"
log "summary: ${WAVE_DIR}/summary.md"

if [[ "${OVERALL_STATUS}" == "fail" ]]; then
  exit 1
fi
