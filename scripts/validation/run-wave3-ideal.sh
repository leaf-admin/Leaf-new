#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

LABEL="wave3-ideal"
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

WAVE_DIR="${RUN_DIR}/wave3"
BACKEND_DIR="${ROOT_DIR}/leaf-websocket-backend"
MOBILE_DIR="${ROOT_DIR}/mobile-app"
UPDATE_TRACKER="${ROOT_DIR}/scripts/validation/update-tracker.cjs"
mkdir -p "${WAVE_DIR}/backend-smoke" "${WAVE_DIR}/mobile-lifecycle"

BACKEND_LOG="${WAVE_DIR}/backend-smoke/stdout.log"
BACKEND_REPORT_COPY="${WAVE_DIR}/backend-smoke/report.json"
MOBILE_LOG="${WAVE_DIR}/mobile-lifecycle/stdout.log"
PASSENGER_UDID="${PASSENGER_UDID:-195D2C57-87DC-4953-ABF1-4FD351ADBBEF}"
DRIVER_UDID="${DRIVER_UDID:-2E44BC8E-9AA8-43BE-BD5E-D0B5A73E543C}"
APP_ID="${APP_ID:-br.com.leaf.ride}"

log "wave3 run dir: ${WAVE_DIR}"

for udid in "${PASSENGER_UDID}" "${DRIVER_UDID}"; do
  xcrun simctl terminate "${udid}" "${APP_ID}" >/dev/null 2>&1 || true
done

BACKEND_STATUS="pass"
if (
  cd "${BACKEND_DIR}" && \
  node scripts/tests/smoke-normal-ride-vps.cjs
) > "${BACKEND_LOG}" 2>&1; then
  :
else
  BACKEND_STATUS="fail"
fi

LATEST_BACKEND_REPORT="$(latest_match "${BACKEND_DIR}/reports" 'normal-ride-smoke-vps-*.json')"
if [[ -n "${LATEST_BACKEND_REPORT}" ]]; then
  cp "${LATEST_BACKEND_REPORT}" "${BACKEND_REPORT_COPY}"
fi

MOBILE_STATUS="pass"
if (
  cd "${MOBILE_DIR}" && \
  ARTIFACTS_DIR="${WAVE_DIR}/mobile-lifecycle/artifacts" \
  bash scripts/run-prototype-ideal-lifecycle-ios.sh
) > "${MOBILE_LOG}" 2>&1; then
  :
else
  MOBILE_STATUS="fail"
fi

OVERALL_STATUS="pass"
if [[ "${BACKEND_STATUS}" != "pass" || "${MOBILE_STATUS}" != "pass" ]]; then
  OVERALL_STATUS="fail"
fi

write_summary_file "${WAVE_DIR}/summary.md" \
"# Wave 3 Summary

- Status: ${OVERALL_STATUS}
- Backend smoke: ${BACKEND_STATUS}
- Mobile lifecycle: ${MOBILE_STATUS}
- Run dir: ${RUN_DIR}

## Evidence

- Backend log: [stdout.log](${BACKEND_LOG})
- Backend report: [report.json](${BACKEND_REPORT_COPY})
- Mobile lifecycle log: [stdout.log](${MOBILE_LOG})
- Mobile artifacts: \`${WAVE_DIR}/mobile-lifecycle/artifacts\`
"

cat > "${WAVE_DIR}/result.json" <<EOF
{
  "wave": "wave3",
  "status": "${OVERALL_STATUS}",
  "backendStatus": "${BACKEND_STATUS}",
  "mobileStatus": "${MOBILE_STATUS}",
  "runDir": "${RUN_DIR}"
}
EOF

node "${UPDATE_TRACKER}" --run-dir "${RUN_DIR}" --scenario W3-001 --status "${BACKEND_STATUS}" --evidence "wave3/backend-smoke/report.json" --notes "driver online and eligible via backend smoke"
node "${UPDATE_TRACKER}" --run-dir "${RUN_DIR}" --scenario W3-003 --status "${BACKEND_STATUS}" --evidence "wave3/backend-smoke/report.json" --notes "booking and fare snapshot from backend smoke"

W3_FLOW_STATUS="${MOBILE_STATUS}"
if [[ "${BACKEND_STATUS}" != "pass" || "${MOBILE_STATUS}" != "pass" ]]; then
  W3_FLOW_STATUS="fail"
fi
node "${UPDATE_TRACKER}" --run-dir "${RUN_DIR}" --scenario W3-002 --status "${W3_FLOW_STATUS}" --evidence "wave3/mobile-lifecycle/artifacts" --notes "quote and payment mock in ideal flow"
node "${UPDATE_TRACKER}" --run-dir "${RUN_DIR}" --scenario W3-004 --status "${W3_FLOW_STATUS}" --evidence "wave3/mobile-lifecycle/artifacts" --notes "offer accept arrive start complete"
node "${UPDATE_TRACKER}" --run-dir "${RUN_DIR}" --scenario W3-005 --status "${W3_FLOW_STATUS}" --evidence "wave3/mobile-lifecycle/artifacts" --notes "receipt and rating completion"

log "wave3 status: ${OVERALL_STATUS}"
log "summary: ${WAVE_DIR}/summary.md"

if [[ "${OVERALL_STATUS}" != "pass" ]]; then
  exit 1
fi
