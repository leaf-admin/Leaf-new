#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

LABEL="master-validation"
RUN_ALL_AUTOMATED=true
SELECTED_WAVES=()

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
    --wave)
      SELECTED_WAVES+=("${2:-}")
      shift 2
      ;;
    --automated-only)
      RUN_ALL_AUTOMATED=true
      shift
      ;;
    *)
      printf '[validation][warn] ignoring unknown arg: %s\n' "$1"
      shift
      ;;
  esac
done

ensure_run_dir "${LABEL}"

if [[ ${#SELECTED_WAVES[@]} -eq 0 && "${RUN_ALL_AUTOMATED}" == "true" ]]; then
  SELECTED_WAVES=("wave0" "wave1" "wave2" "wave3")
fi

log "master run dir: ${RUN_DIR}"
for wave in "${SELECTED_WAVES[@]}"; do
  case "${wave}" in
    wave0)
      bash "${SCRIPT_DIR}/run-wave0-preflight.sh" --run-dir "${RUN_DIR}" --label "${LABEL}"
      ;;
    wave3)
      bash "${SCRIPT_DIR}/run-wave3-ideal.sh" --run-dir "${RUN_DIR}" --label "${LABEL}"
      ;;
    wave1)
      bash "${SCRIPT_DIR}/run-wave1-auth-kyc.sh" --run-dir "${RUN_DIR}" --label "${LABEL}"
      ;;
    wave2)
      bash "${SCRIPT_DIR}/run-wave2-eligibility.sh" --run-dir "${RUN_DIR}" --label "${LABEL}"
      ;;
    wave9)
      bash "${SCRIPT_DIR}/run-wave9-production-readiness.sh" --run-dir "${RUN_DIR}" --label "${LABEL}"
      ;;
    *)
      log "wave ${wave} has no automated runner yet; leaving as manual in tracker"
      ;;
  esac
done

write_summary_file "${RUN_DIR}/summary.md" \
"# Master Validation Summary

- Run dir: ${RUN_DIR}
- Executed waves: ${SELECTED_WAVES[*]}
- Tracker: [tracker.md](${RUN_DIR}/tracker.md)
- Notes: [notes.md](${RUN_DIR}/notes.md)

Automated runners currently implemented:

- wave0 preflight
- wave1 auth/kyc
- wave2 eligibility/geofence
- wave3 ideal lifecycle
- wave9 production-readiness closure
"

log "master validation ready: ${RUN_DIR}"
