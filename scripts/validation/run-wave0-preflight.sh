#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

LABEL="wave0-preflight"
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

WAVE_DIR="${RUN_DIR}/wave0"
EVIDENCE_DIR="${WAVE_DIR}/evidence"
mkdir -p "${EVIDENCE_DIR}"

MOBILE_PREFLIGHT="${ROOT_DIR}/mobile-app/scripts/qa/preflight-dual-ios-vps.sh"
BACKEND_ADMIN_AUTH="${ROOT_DIR}/leaf-websocket-backend/scripts/tests/test-admin-auth.js"
MOBILE_PREFLIGHT_OUTPUT_DIR="${ROOT_DIR}/mobile-app/test-results/qa-preflight"
UPDATE_TRACKER="${ROOT_DIR}/scripts/validation/update-tracker.cjs"
DEFAULT_TEST_ADMIN_EMAIL="${TEST_ADMIN_EMAIL:-admin@leaf.com}"
DEFAULT_TEST_ADMIN_PASSWORD="${TEST_ADMIN_PASSWORD:-admin123}"

canonical_users_status="fail"
dispatch_smoke_status="fail"
dispatch_smoke_notes="dispatch and booking smoke"

log "wave0 run dir: ${WAVE_DIR}"

PREFLIGHT_STDOUT="${WAVE_DIR}/logs-preflight.stdout.log"
if bash "${MOBILE_PREFLIGHT}" | tee "${PREFLIGHT_STDOUT}"; then
  PREFLIGHT_STATUS="pass"
else
  PREFLIGHT_STATUS="fail"
fi

for artifact in \
  "$(latest_match "${MOBILE_PREFLIGHT_OUTPUT_DIR}" 'preflight-*.log')" \
  "${MOBILE_PREFLIGHT_OUTPUT_DIR}/ensure-users.json" \
  "${MOBILE_PREFLIGHT_OUTPUT_DIR}/runtime-cleanup.json" \
  "${MOBILE_PREFLIGHT_OUTPUT_DIR}/payment-check.json" \
  "${MOBILE_PREFLIGHT_OUTPUT_DIR}/api-health-full.json" \
  "${MOBILE_PREFLIGHT_OUTPUT_DIR}/smoke-driver-ready-booking.json" \
  "${MOBILE_PREFLIGHT_OUTPUT_DIR}/driver-status.json" \
  "${MOBILE_PREFLIGHT_OUTPUT_DIR}/maestro-runtime-env.sh"
do
  [[ -n "${artifact}" ]] && copy_if_exists "${artifact}" "${EVIDENCE_DIR}"
done

if [[ -f "${MOBILE_PREFLIGHT_OUTPUT_DIR}/ensure-users.json" ]]; then
  ensured_passenger_uid="$(jq -r '.passenger.uid // empty' "${MOBILE_PREFLIGHT_OUTPUT_DIR}/ensure-users.json" 2>/dev/null || true)"
  ensured_driver_uid="$(jq -r '.driver.uid // empty' "${MOBILE_PREFLIGHT_OUTPUT_DIR}/ensure-users.json" 2>/dev/null || true)"
  if [[ -n "${ensured_passenger_uid}" && -n "${ensured_driver_uid}" ]]; then
    canonical_users_status="pass"
  fi
fi

if [[ -f "${MOBILE_PREFLIGHT_OUTPUT_DIR}/smoke-driver-ready-booking.json" ]]; then
  smoke_ok="$(jq -r '.ok // false' "${MOBILE_PREFLIGHT_OUTPUT_DIR}/smoke-driver-ready-booking.json" 2>/dev/null || echo "false")"
  smoke_error="$(jq -r '.error // empty' "${MOBILE_PREFLIGHT_OUTPUT_DIR}/smoke-driver-ready-booking.json" 2>/dev/null || true)"
  if [[ "${smoke_ok}" == "true" ]]; then
    dispatch_smoke_status="pass"
    dispatch_smoke_notes="dispatch and booking smoke"
  else
    dispatch_smoke_notes="dispatch and booking smoke (${smoke_error:-unknown_error})"
  fi
fi

ADMIN_AUTH_STATUS="fail"
ADMIN_AUTH_LOG="${WAVE_DIR}/logs-admin-auth.log"
if (
  cd "${ROOT_DIR}/leaf-websocket-backend" && \
  API_URL="${API_BASE_URL:-https://api.leaf.app.br}" \
  TEST_ADMIN_EMAIL="${DEFAULT_TEST_ADMIN_EMAIL}" \
  TEST_ADMIN_PASSWORD="${DEFAULT_TEST_ADMIN_PASSWORD}" \
  node "${BACKEND_ADMIN_AUTH}"
) > "${ADMIN_AUTH_LOG}" 2>&1; then
  ADMIN_AUTH_STATUS="pass"
fi

OVERALL_STATUS="pass"
if [[ "${PREFLIGHT_STATUS}" != "pass" ]]; then
  OVERALL_STATUS="fail"
elif [[ "${canonical_users_status}" != "pass" ]]; then
  OVERALL_STATUS="fail"
elif [[ "${dispatch_smoke_status}" != "pass" ]]; then
  OVERALL_STATUS="fail"
elif [[ "${ADMIN_AUTH_STATUS}" == "fail" ]]; then
  OVERALL_STATUS="fail"
fi

write_summary_file "${WAVE_DIR}/summary.md" \
"# Wave 0 Summary

- Status: ${OVERALL_STATUS}
- Preflight: ${PREFLIGHT_STATUS}
- Admin auth: ${ADMIN_AUTH_STATUS}
- Run dir: ${RUN_DIR}
- Evidence dir: ${EVIDENCE_DIR}

## Evidence

- Preflight stdout: [logs-preflight.stdout.log](${PREFLIGHT_STDOUT})
- Admin auth log: [logs-admin-auth.log](${ADMIN_AUTH_LOG})
- Copied preflight artifacts: \`${EVIDENCE_DIR}\`
"

cat > "${WAVE_DIR}/result.json" <<EOF
{
  "wave": "wave0",
  "status": "${OVERALL_STATUS}",
  "preflightStatus": "${PREFLIGHT_STATUS}",
  "adminAuthStatus": "${ADMIN_AUTH_STATUS}",
  "runDir": "${RUN_DIR}",
  "evidenceDir": "${EVIDENCE_DIR}"
}
EOF

node "${UPDATE_TRACKER}" --run-dir "${RUN_DIR}" --scenario W0-001 --status "${PREFLIGHT_STATUS}" --evidence "wave0/summary.md" --notes "preflight environment, readiness and simulator baseline"
node "${UPDATE_TRACKER}" --run-dir "${RUN_DIR}" --scenario W0-002 --status "${canonical_users_status}" --evidence "wave0/evidence/ensure-users.json" --notes "canonical test users ensured inside preflight"
node "${UPDATE_TRACKER}" --run-dir "${RUN_DIR}" --scenario W0-003 --status "${dispatch_smoke_status}" --evidence "wave0/evidence/smoke-driver-ready-booking.json" --notes "${dispatch_smoke_notes}"

node "${UPDATE_TRACKER}" --run-dir "${RUN_DIR}" --scenario W0-004 --status "${ADMIN_AUTH_STATUS}" --evidence "wave0/logs-admin-auth.log" --notes "dashboard admin auth (${DEFAULT_TEST_ADMIN_EMAIL})"

log "wave0 status: ${OVERALL_STATUS}"
log "summary: ${WAVE_DIR}/summary.md"

if [[ "${OVERALL_STATUS}" != "pass" ]]; then
  exit 1
fi
