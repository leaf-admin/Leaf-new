#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
REPORTS_ROOT="${ROOT_DIR}/reports/validation-runs"
MANIFEST_PATH="${ROOT_DIR}/docs/validation/master-validation-manifest.json"
INIT_SCRIPT="${ROOT_DIR}/scripts/validation/init-validation-run.cjs"
READ_SIM_RUNTIME_SCRIPT="${ROOT_DIR}/scripts/validation/lib/read-sim-runtime-state.cjs"

timestamp_now() {
  date +%Y%m%d_%H%M%S
}

slugify() {
  printf '%s' "${1:-validation}" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//'
}

log() {
  printf '[validation] %s\n' "$*"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '[validation][error] missing command: %s\n' "$1" >&2
    exit 1
  fi
}

read_sim_runtime_field() {
  local udid="$1"
  local app_id="$2"
  local field="$3"
  node "${READ_SIM_RUNTIME_SCRIPT}" --udid "${udid}" --app-id "${app_id}" --field "${field}"
}

wait_for_driver_online() {
  local udid="$1"
  local app_id="$2"
  local timeout_seconds="${3:-45}"
  local started_at
  local stable_online_samples=0
  started_at="$(date +%s)"

  while true; do
    local driver_online=""
    local driver_online_pending=""
    local driver_online_source=""

    driver_online="$(read_sim_runtime_field "${udid}" "${app_id}" "driverOnline" 2>/dev/null || true)"
    driver_online_pending="$(read_sim_runtime_field "${udid}" "${app_id}" "driverOnlinePending" 2>/dev/null || true)"
    driver_online_source="$(read_sim_runtime_field "${udid}" "${app_id}" "driverOnlineMutationSource" 2>/dev/null || true)"

    if [[ "${driver_online}" == "true" && "${driver_online_pending}" != "true" ]]; then
      stable_online_samples=$((stable_online_samples + 1))
      if (( stable_online_samples >= 3 )); then
        return 0
      fi
    else
      stable_online_samples=0
    fi

    if (( $(date +%s) - started_at >= timeout_seconds )); then
      log "driver online wait timed out (online=${driver_online:-unknown}, pending=${driver_online_pending:-unknown}, source=${driver_online_source:-unknown})"
      return 1
    fi

    sleep 2
  done
}

ensure_run_dir() {
  local label="${1:-validation}"
  if [[ -n "${RUN_DIR:-}" ]]; then
    mkdir -p "${RUN_DIR}"
    return 0
  fi

  require_cmd node
  # shellcheck disable=SC2046
  eval "$(node "${INIT_SCRIPT}" --label "${label}" --print-env)"
  export RUN_DIR
}

latest_match() {
  local search_dir="$1"
  local pattern="$2"
  find "${search_dir}" -maxdepth 1 -type f -name "${pattern}" -print 2>/dev/null | sort | tail -n 1
}

copy_if_exists() {
  local source_path="$1"
  local target_dir="$2"
  [[ -f "${source_path}" ]] || return 0
  mkdir -p "${target_dir}"
  cp "${source_path}" "${target_dir}/"
}

write_summary_file() {
  local target="$1"
  shift
  mkdir -p "$(dirname "${target}")"
  cat > "${target}" <<EOF
$*
EOF
}
