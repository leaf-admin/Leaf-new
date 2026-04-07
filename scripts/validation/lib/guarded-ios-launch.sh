#!/usr/bin/env bash
set -euo pipefail

UDID="${1:?missing simulator udid}"
APP_ID="${2:?missing app id}"
WAIT_SECONDS="${3:-8}"
ARTIFACTS_DIR="${4:-}"
APP_NAME="${APP_NAME:-Leaf}"
MAX_LAUNCH_ATTEMPTS="${MAX_LAUNCH_ATTEMPTS:-2}"

latest_crash_report() {
  ls -1t "${HOME}/Library/Logs/DiagnosticReports/${APP_NAME}"-*.ips 2>/dev/null | head -n 1 || true
}

latest_crash_mtime() {
  local report_path="$1"
  [[ -n "${report_path}" && -f "${report_path}" ]] || {
    printf '0\n'
    return 0
  }
  stat -f '%m' "${report_path}" 2>/dev/null || printf '0\n'
}

wait_for_new_crash_report() {
  local baseline_mtime="$1"
  local grace_seconds="${2:-4}"
  local deadline=$((SECONDS + grace_seconds))

  while (( SECONDS < deadline )); do
    local latest_report
    local latest_mtime
    latest_report="$(latest_crash_report)"
    latest_mtime="$(latest_crash_mtime "${latest_report}")"
    if [[ -n "${latest_report}" && "${latest_mtime}" -gt "${baseline_mtime}" ]]; then
      printf '%s\n' "${latest_report}"
      return 0
    fi
    sleep 1
  done

  return 1
}

copy_crash_artifacts() {
  local report_path="$1"
  [[ -n "${ARTIFACTS_DIR}" ]] || return 0
  mkdir -p "${ARTIFACTS_DIR}"

  if [[ -n "${report_path}" && -f "${report_path}" ]]; then
    cp "${report_path}" "${ARTIFACTS_DIR}/$(basename "${report_path}")"
  fi

  xcrun simctl io "${UDID}" screenshot "${ARTIFACTS_DIR}/launch-crash-screen.png" >/dev/null 2>&1 || true
}

classify_crash_report() {
  local report_path="$1"
  python3 - "$report_path" <<'PY'
import json
import sys
from pathlib import Path

report_path = Path(sys.argv[1])
if not report_path.exists():
    print("unknown")
    raise SystemExit(0)

raw = report_path.read_text(encoding="utf-8", errors="replace")
objects = []
buffer = []
depth = 0
for ch in raw:
    if ch == "{":
        depth += 1
    if depth > 0:
        buffer.append(ch)
    if ch == "}":
        depth -= 1
        if depth == 0 and buffer:
            try:
                objects.append(json.loads("".join(buffer)))
            except Exception:
                break
            buffer = []

report = objects[-1] if objects else {}
threads = report.get("threads") or []
faulting_thread_id = report.get("faultingThread")
faulting_thread = None
for thread in threads:
    if thread.get("triggered") or thread.get("id") == faulting_thread_id:
        faulting_thread = thread
        break

frames = (faulting_thread or {}).get("frames") or []
used_images = report.get("usedImages") or []
frame_images = []
frame_symbols = []
for frame in frames[:8]:
    image_index = frame.get("imageIndex")
    if isinstance(image_index, int) and 0 <= image_index < len(used_images):
        frame_images.append((used_images[image_index] or {}).get("name") or "")
    frame_symbols.append(str(frame.get("symbol") or ""))

first_symbol = frame_symbols[0] if frame_symbols else ""
report_notes = [str(note or "") for note in report.get("reportNotes") or []]
has_dyld_signature = (
    "DyldSharedCache::getUUID" in first_symbol
    or any("_dyld_sim_prepare" in symbol for symbol in frame_symbols)
    or "dyld_sim" in frame_images
)
has_only_dyld_frames = bool(frame_images) and all(name in {"dyld", "dyld_sim"} for name in frame_images if name)
has_shared_cache_note = any("dyld_process_snapshot_get_shared_cache failed" in note for note in report_notes)

if has_dyld_signature or has_only_dyld_frames or has_shared_cache_note:
    print("simulator_runtime")
else:
    print("app_runtime")
PY
}

write_crash_metadata() {
  local report_path="$1"
  local crash_kind="$2"
  [[ -n "${ARTIFACTS_DIR}" ]] || return 0
  mkdir -p "${ARTIFACTS_DIR}"
  cat > "${ARTIFACTS_DIR}/launch-crash-metadata.json" <<EOF
{
  "kind": "${crash_kind}",
  "reportPath": "${report_path}",
  "udid": "${UDID}",
  "appId": "${APP_ID}"
}
EOF
}

recover_simulator_runtime() {
  xcrun simctl terminate "${UDID}" "${APP_ID}" >/dev/null 2>&1 || true
  xcrun simctl shutdown "${UDID}" >/dev/null 2>&1 || true
  sleep 1
  xcrun simctl boot "${UDID}" >/dev/null 2>&1 || true
  xcrun simctl bootstatus "${UDID}" -b >/dev/null 2>&1 || true
  sleep 1
}

attempt=1
while (( attempt <= MAX_LAUNCH_ATTEMPTS )); do
  baseline_report="$(latest_crash_report)"
  baseline_mtime="$(latest_crash_mtime "${baseline_report}")"

  if (( attempt > 1 )); then
    printf '[ios-guard][retry] restarting simulator runtime before retry %s/%s\n' "${attempt}" "${MAX_LAUNCH_ATTEMPTS}" >&2
    recover_simulator_runtime
  fi

  launch_output="$(xcrun simctl launch "${UDID}" "${APP_ID}" 2>&1)" || {
    printf '%s\n' "${launch_output}" >&2
    exit 1
  }

  launch_pid="$(printf '%s\n' "${launch_output}" | awk -F': ' 'NF > 1 { print $NF }' | tr -dc '0-9')"
  deadline=$((SECONDS + WAIT_SECONDS))

  if [[ -z "${launch_pid}" ]]; then
    printf '%s\n' "${launch_output}"
    exit 0
  fi

  retry_due_to_simulator=0
  while (( SECONDS < deadline )); do
    if ! kill -0 "${launch_pid}" >/dev/null 2>&1; then
      if latest_report="$(wait_for_new_crash_report "${baseline_mtime}" 4)"; then
        crash_kind="$(classify_crash_report "${latest_report}")"
        copy_crash_artifacts "${latest_report}"
        write_crash_metadata "${latest_report}" "${crash_kind}"
        if [[ "${crash_kind}" == "simulator_runtime" && "${attempt}" -lt "${MAX_LAUNCH_ATTEMPTS}" ]]; then
          printf '[ios-guard][retry] simulator runtime crash detected: %s\n' "${latest_report}" >&2
          retry_due_to_simulator=1
          break
        fi
        printf '[ios-guard][crash] app crashed during launch (%s): %s\n' "${crash_kind}" "${latest_report}" >&2
        exit 10
      fi

      copy_crash_artifacts ""
      printf '[ios-guard][error] app exited during launch before settle window (pid=%s)\n' "${launch_pid}" >&2
      exit 11
    fi
    sleep 1
  done

  if (( retry_due_to_simulator == 1 )); then
    attempt=$((attempt + 1))
    continue
  fi

  if latest_report="$(wait_for_new_crash_report "${baseline_mtime}" 1)"; then
    crash_kind="$(classify_crash_report "${latest_report}")"
    copy_crash_artifacts "${latest_report}"
    write_crash_metadata "${latest_report}" "${crash_kind}"
    if [[ "${crash_kind}" == "simulator_runtime" && "${attempt}" -lt "${MAX_LAUNCH_ATTEMPTS}" ]]; then
      printf '[ios-guard][retry] simulator runtime crash detected during settle window: %s\n' "${latest_report}" >&2
      attempt=$((attempt + 1))
      continue
    fi
    printf '[ios-guard][crash] app crashed during settle window (%s): %s\n' "${crash_kind}" "${latest_report}" >&2
    exit 10
  fi

  printf '%s\n' "${launch_output}"
  exit 0
done

printf '[ios-guard][error] simulator runtime crash persisted after %s attempts\n' "${MAX_LAUNCH_ATTEMPTS}" >&2
exit 12
