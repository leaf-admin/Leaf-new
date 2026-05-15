#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# shellcheck source=/dev/null
source "${SCRIPT_DIR}/source-local-build-env.sh"

APP_PACKAGE="${APP_PACKAGE:-br.com.leaf.ride}"
BACKEND_URL="${BACKEND_URL:-https://api.leaf.app.br}"
BACKEND_HEALTH_ENDPOINT="${BACKEND_HEALTH_ENDPOINT:-/api/health}"
ADB_BIN="${ADB_BIN:-$(command -v adb || true)}"
ANDROID_SERIAL="${ANDROID_SERIAL:-}"
SESSION_SECONDS="${SESSION_SECONDS:-0}"
OPEN_APP="${OPEN_APP:-true}"
RECORD_SCREEN="${RECORD_SCREEN:-true}"
SCREEN_TIME_LIMIT="${SCREEN_TIME_LIMIT:-180}"
BACKEND_HEALTH_URL="${BACKEND_URL%/}${BACKEND_HEALTH_ENDPOINT}"

resolve_adb() {
  if [[ -n "${ADB_BIN}" && -x "${ADB_BIN}" ]]; then
    return
  fi

  for candidate in \
    "${HOME}/Android/Sdk/platform-tools/adb" \
    "${HOME}/Library/Android/sdk/platform-tools/adb" \
    "${PROJECT_DIR}/../android-sdk/platform-tools/adb" \
    "${PROJECT_DIR}/../platform-tools/adb"; do
    if [[ -x "${candidate}" ]]; then
      ADB_BIN="${candidate}"
      return
    fi
  done
}

resolve_serial() {
  if [[ -n "${ANDROID_SERIAL}" ]]; then
    return
  fi

  local physical
  physical="$("${ADB_BIN}" devices | awk 'NR>1 && $2=="device" && $1 !~ /^emulator-/{print $1; exit}')"
  if [[ -n "${physical}" ]]; then
    ANDROID_SERIAL="${physical}"
    return
  fi

  local first
  first="$("${ADB_BIN}" devices | awk 'NR>1 && $2=="device"{print $1; exit}')"
  ANDROID_SERIAL="${first}"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[phase6][error] Missing command: $1"
    exit 1
  fi
}

resolve_adb
if [[ -z "${ADB_BIN}" || ! -x "${ADB_BIN}" ]]; then
  echo "[phase6][error] adb not found. Set ADB_BIN or install Android platform-tools."
  exit 1
fi

require_cmd curl

"${ADB_BIN}" start-server >/dev/null 2>&1 || true
resolve_serial
if [[ -z "${ANDROID_SERIAL}" ]]; then
  echo "[phase6][error] No Android device connected."
  exit 1
fi

if ! "${ADB_BIN}" -s "${ANDROID_SERIAL}" get-state >/dev/null 2>&1; then
  echo "[phase6][error] Device ${ANDROID_SERIAL} not available."
  exit 1
fi

if ! "${ADB_BIN}" -s "${ANDROID_SERIAL}" shell pm list packages | grep -q "${APP_PACKAGE}"; then
  echo "[phase6][error] App package not installed: ${APP_PACKAGE}"
  exit 1
fi

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
ARTIFACTS_DIR="${PROJECT_DIR}/test-results/phase6_manual_device_${TIMESTAMP}"
mkdir -p "${ARTIFACTS_DIR}"

LOGCAT_FILE="${ARTIFACTS_DIR}/android-logcat.txt"
CRITICAL_FILE="${ARTIFACTS_DIR}/critical-log-lines.txt"
SUMMARY_FILE="${ARTIFACTS_DIR}/summary.md"
CHECKLIST_FILE="${ARTIFACTS_DIR}/manual-checklist.md"
REMOTE_VIDEO="/sdcard/leaf_phase6_${TIMESTAMP}.mp4"
LOCAL_VIDEO="${ARTIFACTS_DIR}/session.mp4"

LOGCAT_PID=""
SCREEN_PID=""
FINALIZED=0

cleanup() {
  if [[ "${FINALIZED}" -eq 1 ]]; then
    return
  fi
  FINALIZED=1

  if [[ -n "${SCREEN_PID}" ]] && kill -0 "${SCREEN_PID}" >/dev/null 2>&1; then
    kill "${SCREEN_PID}" >/dev/null 2>&1 || true
    wait "${SCREEN_PID}" 2>/dev/null || true
  fi

  if [[ -n "${LOGCAT_PID}" ]] && kill -0 "${LOGCAT_PID}" >/dev/null 2>&1; then
    kill "${LOGCAT_PID}" >/dev/null 2>&1 || true
    wait "${LOGCAT_PID}" 2>/dev/null || true
  fi

  if [[ "${RECORD_SCREEN}" == "true" ]]; then
    "${ADB_BIN}" -s "${ANDROID_SERIAL}" pull "${REMOTE_VIDEO}" "${LOCAL_VIDEO}" >/dev/null 2>&1 || true
    "${ADB_BIN}" -s "${ANDROID_SERIAL}" shell rm "${REMOTE_VIDEO}" >/dev/null 2>&1 || true
  fi

  "${ADB_BIN}" -s "${ANDROID_SERIAL}" shell dumpsys meminfo "${APP_PACKAGE}" > "${ARTIFACTS_DIR}/meminfo.txt" 2>&1 || true
  "${ADB_BIN}" -s "${ANDROID_SERIAL}" shell getprop ro.product.model > "${ARTIFACTS_DIR}/device-model.txt" || true
  "${ADB_BIN}" -s "${ANDROID_SERIAL}" shell getprop ro.build.version.release > "${ARTIFACTS_DIR}/android-version.txt" || true
  "${ADB_BIN}" -s "${ANDROID_SERIAL}" shell dumpsys package "${APP_PACKAGE}" > "${ARTIFACTS_DIR}/package-dump.txt" 2>&1 || true
  curl -sS --max-time 12 "${BACKEND_HEALTH_URL}" > "${ARTIFACTS_DIR}/backend-health.json" || true

  grep -E " [EF]/" "${LOGCAT_FILE}" | grep -Ei "FATAL EXCEPTION|ANR in|CRASH|Unhandled|TypeError|ReferenceError|SIGABRT|IllegalStateException" > "${CRITICAL_FILE}" || true
  local critical_count
  critical_count="$(wc -l < "${CRITICAL_FILE}" | tr -d '[:space:]')"

  cat > "${CHECKLIST_FILE}" <<'EOF'
# Fase 6 - Checklist manual (device real)

- [ ] Login e persistencia de sessao (fechar/reabrir app).
- [ ] Passageiro: origem -> corrida -> pagamento -> recibo.
- [ ] Motorista: online -> aceitar -> iniciar -> finalizar.
- [ ] Localizacao foreground/background.
- [ ] Push: foreground/background/cold start.
- [ ] Upload de documentos: camera, galeria e PDF.
- [ ] Chat + websocket em corrida ativa.
- [ ] OTA (expo-updates) validado.
EOF

  cat > "${SUMMARY_FILE}" <<EOF
# Fase 6 - Sessao manual em device real

- Timestamp: ${TIMESTAMP}
- Device serial: ${ANDROID_SERIAL}
- Package: ${APP_PACKAGE}
- Backend base: ${BACKEND_URL}
- Backend health: ${BACKEND_HEALTH_URL}
- Critical log lines: ${critical_count}
- Artifacts dir: ${ARTIFACTS_DIR}
- Screen recording: $( [[ -f "${LOCAL_VIDEO}" ]] && echo "captured" || echo "not captured" )

## Arquivos

- android-logcat.txt
- critical-log-lines.txt
- backend-health.json
- meminfo.txt
- package-dump.txt
- manual-checklist.md
EOF

  echo "[phase6] report: ${SUMMARY_FILE}"
}

trap cleanup EXIT INT TERM

echo "[phase6] artifacts: ${ARTIFACTS_DIR}"
echo "[phase6] device: ${ANDROID_SERIAL}"
echo "[phase6] package: ${APP_PACKAGE}"

"${ADB_BIN}" -s "${ANDROID_SERIAL}" logcat -c >/dev/null 2>&1 || true
"${ADB_BIN}" -s "${ANDROID_SERIAL}" logcat -v time > "${LOGCAT_FILE}" 2>&1 &
LOGCAT_PID=$!

if [[ "${RECORD_SCREEN}" == "true" ]]; then
  "${ADB_BIN}" -s "${ANDROID_SERIAL}" shell screenrecord --time-limit "${SCREEN_TIME_LIMIT}" "${REMOTE_VIDEO}" >/dev/null 2>&1 &
  SCREEN_PID=$!
fi

if [[ "${OPEN_APP}" == "true" ]]; then
  "${ADB_BIN}" -s "${ANDROID_SERIAL}" shell am force-stop "${APP_PACKAGE}" >/dev/null 2>&1 || true
  "${ADB_BIN}" -s "${ANDROID_SERIAL}" shell am start -n "${APP_PACKAGE}/.MainActivity" >/dev/null 2>&1 \
    || "${ADB_BIN}" -s "${ANDROID_SERIAL}" shell monkey -p "${APP_PACKAGE}" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
fi

if [[ "${SESSION_SECONDS}" -gt 0 ]]; then
  echo "[phase6] Running timed session for ${SESSION_SECONDS}s. Execute manual flow on device now..."
  sleep "${SESSION_SECONDS}"
else
  echo "[phase6] Execute the manual flow on device now."
  echo "[phase6] Press Enter here when done."
  read -r _
fi
