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
IOS_SIM_UDID="${IOS_SIM_UDID:-}"
SESSION_SECONDS="${SESSION_SECONDS:-0}"
OPEN_APPS="${OPEN_APPS:-true}"
RECORD_SCREEN="${RECORD_SCREEN:-true}"
ANDROID_VIDEO_LIMIT="${ANDROID_VIDEO_LIMIT:-180}"
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

resolve_android_serial() {
  if [[ -n "${ANDROID_SERIAL}" ]]; then
    return
  fi
  local physical
  physical="$("${ADB_BIN}" devices | awk 'NR>1 && $2=="device" && $1 !~ /^emulator-/{print $1; exit}')"
  if [[ -n "${physical}" ]]; then
    ANDROID_SERIAL="${physical}"
    return
  fi
  ANDROID_SERIAL="$("${ADB_BIN}" devices | awk 'NR>1 && $2=="device"{print $1; exit}')"
}

resolve_ios_sim() {
  if [[ -n "${IOS_SIM_UDID}" ]]; then
    return
  fi
  IOS_SIM_UDID="$(xcrun simctl list devices booted | sed -n 's/.*(\([A-F0-9-]\{36\}\)) (Booted).*/\1/p' | head -n1)"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[phase6-cross][error] Missing command: $1"
    exit 1
  fi
}

resolve_adb
if [[ -z "${ADB_BIN}" || ! -x "${ADB_BIN}" ]]; then
  echo "[phase6-cross][error] adb not found."
  exit 1
fi

require_cmd curl
require_cmd xcrun

"${ADB_BIN}" start-server >/dev/null 2>&1 || true
resolve_android_serial
if [[ -z "${ANDROID_SERIAL}" ]]; then
  echo "[phase6-cross][error] No Android device connected."
  exit 1
fi
if ! "${ADB_BIN}" -s "${ANDROID_SERIAL}" get-state >/dev/null 2>&1; then
  echo "[phase6-cross][error] Android serial unavailable: ${ANDROID_SERIAL}"
  exit 1
fi
if ! "${ADB_BIN}" -s "${ANDROID_SERIAL}" shell pm list packages | grep -q "${APP_PACKAGE}"; then
  echo "[phase6-cross][error] Android app not installed: ${APP_PACKAGE}"
  exit 1
fi

resolve_ios_sim
if [[ -z "${IOS_SIM_UDID}" ]]; then
  echo "[phase6-cross][error] No iOS simulator booted."
  exit 1
fi

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
ARTIFACTS_DIR="${PROJECT_DIR}/test-results/phase6_cross_${TIMESTAMP}"
mkdir -p "${ARTIFACTS_DIR}"

ANDROID_LOG="${ARTIFACTS_DIR}/android-logcat.txt"
IOS_LOG="${ARTIFACTS_DIR}/ios-sim.log"
ANDROID_CRIT="${ARTIFACTS_DIR}/android-critical-log-lines.txt"
IOS_CRIT="${ARTIFACTS_DIR}/ios-critical-log-lines.txt"
SUMMARY_FILE="${ARTIFACTS_DIR}/summary.md"
CHECKLIST_FILE="${ARTIFACTS_DIR}/manual-checklist.md"

ANDROID_REMOTE_VIDEO="/sdcard/leaf_phase6_cross_${TIMESTAMP}.mp4"
ANDROID_VIDEO="${ARTIFACTS_DIR}/android-session.mp4"
IOS_VIDEO="${ARTIFACTS_DIR}/ios-sim-session.mp4"

ANDROID_LOG_PID=""
IOS_LOG_PID=""
ANDROID_VIDEO_PID=""
IOS_VIDEO_PID=""
FINALIZED=0

cleanup() {
  if [[ "${FINALIZED}" -eq 1 ]]; then
    return
  fi
  FINALIZED=1

  if [[ -n "${IOS_VIDEO_PID}" ]] && kill -0 "${IOS_VIDEO_PID}" >/dev/null 2>&1; then
    kill -INT "${IOS_VIDEO_PID}" >/dev/null 2>&1 || true
    wait "${IOS_VIDEO_PID}" 2>/dev/null || true
  fi
  if [[ -n "${ANDROID_VIDEO_PID}" ]] && kill -0 "${ANDROID_VIDEO_PID}" >/dev/null 2>&1; then
    kill "${ANDROID_VIDEO_PID}" >/dev/null 2>&1 || true
    wait "${ANDROID_VIDEO_PID}" 2>/dev/null || true
  fi
  if [[ -n "${IOS_LOG_PID}" ]] && kill -0 "${IOS_LOG_PID}" >/dev/null 2>&1; then
    kill "${IOS_LOG_PID}" >/dev/null 2>&1 || true
    wait "${IOS_LOG_PID}" 2>/dev/null || true
  fi
  if [[ -n "${ANDROID_LOG_PID}" ]] && kill -0 "${ANDROID_LOG_PID}" >/dev/null 2>&1; then
    kill "${ANDROID_LOG_PID}" >/dev/null 2>&1 || true
    wait "${ANDROID_LOG_PID}" 2>/dev/null || true
  fi

  if [[ "${RECORD_SCREEN}" == "true" ]]; then
    "${ADB_BIN}" -s "${ANDROID_SERIAL}" pull "${ANDROID_REMOTE_VIDEO}" "${ANDROID_VIDEO}" >/dev/null 2>&1 || true
    "${ADB_BIN}" -s "${ANDROID_SERIAL}" shell rm "${ANDROID_REMOTE_VIDEO}" >/dev/null 2>&1 || true
  fi

  "${ADB_BIN}" -s "${ANDROID_SERIAL}" shell dumpsys meminfo "${APP_PACKAGE}" > "${ARTIFACTS_DIR}/android-meminfo.txt" 2>&1 || true
  "${ADB_BIN}" -s "${ANDROID_SERIAL}" shell getprop ro.product.model > "${ARTIFACTS_DIR}/android-device-model.txt" || true
  "${ADB_BIN}" -s "${ANDROID_SERIAL}" shell getprop ro.build.version.release > "${ARTIFACTS_DIR}/android-version.txt" || true
  xcrun simctl getenv "${IOS_SIM_UDID}" SIMULATOR_DEVICE_NAME > "${ARTIFACTS_DIR}/ios-sim-device-name.txt" 2>/dev/null || true
  xcrun simctl spawn "${IOS_SIM_UDID}" defaults read /Library/Preferences/.GlobalPreferences AppleLocale > "${ARTIFACTS_DIR}/ios-sim-locale.txt" 2>/dev/null || true
  curl -sS --max-time 12 "${BACKEND_HEALTH_URL}" > "${ARTIFACTS_DIR}/backend-health.json" || true

  grep -Ei "FATAL EXCEPTION|AndroidRuntime|Fatal signal|ANR in ${APP_PACKAGE}|TypeError|ReferenceError|Unhandled promise rejection|SIGABRT" "${ANDROID_LOG}" > "${ANDROID_CRIT}" || true
  grep -Ei "terminating app due to uncaught exception|fatal error|uncaught exception|EXC_BAD_ACCESS|SIGABRT|TypeError|ReferenceError|RCTFatal" "${IOS_LOG}" | grep -Evi "ATS exception" > "${IOS_CRIT}" || true

  local android_crit ios_crit
  android_crit="$(wc -l < "${ANDROID_CRIT}" | tr -d '[:space:]')"
  ios_crit="$(wc -l < "${IOS_CRIT}" | tr -d '[:space:]')"

  cat > "${CHECKLIST_FILE}" <<'EOF'
# Fase 6 - Checklist manual (Android fisico + iOS Simulator)

- [ ] Motorista (Android fisico): online -> aceitar -> iniciar -> finalizar.
- [ ] Passageiro (iOS Simulator): origem -> solicitar corrida -> acompanhar -> pagamento -> recibo.
- [ ] Handoff navegacao externa no motorista (abrir maps externo e retornar ao app).
- [ ] Tracking e atualizacao de localizacao em corrida ativa sem perda de estado.
- [ ] Chat + websocket em corrida ativa.
- [ ] Persistencia de sessao (fechar/reabrir em ambos).
EOF

  cat > "${SUMMARY_FILE}" <<EOF
# Fase 6 - Sessao cruzada Android fisico + iOS Simulator

- Timestamp: ${TIMESTAMP}
- Android serial: ${ANDROID_SERIAL}
- iOS simulator: ${IOS_SIM_UDID}
- Package: ${APP_PACKAGE}
- Backend base: ${BACKEND_URL}
- Backend health: ${BACKEND_HEALTH_URL}
- Android critical log lines: ${android_crit}
- iOS critical log lines: ${ios_crit}
- Artifacts dir: ${ARTIFACTS_DIR}
- Android video: $( [[ -f "${ANDROID_VIDEO}" ]] && echo "captured" || echo "not captured" )
- iOS sim video: $( [[ -f "${IOS_VIDEO}" ]] && echo "captured" || echo "not captured" )

## Arquivos

- android-logcat.txt
- ios-sim.log
- android-critical-log-lines.txt
- ios-critical-log-lines.txt
- backend-health.json
- manual-checklist.md
EOF

  echo "[phase6-cross] report: ${SUMMARY_FILE}"
}

trap cleanup EXIT INT TERM

echo "[phase6-cross] artifacts: ${ARTIFACTS_DIR}"
echo "[phase6-cross] android: ${ANDROID_SERIAL}"
echo "[phase6-cross] ios-sim: ${IOS_SIM_UDID}"

if [[ "${OPEN_APPS}" == "true" ]]; then
  "${ADB_BIN}" -s "${ANDROID_SERIAL}" shell am force-stop "${APP_PACKAGE}" >/dev/null 2>&1 || true
  "${ADB_BIN}" -s "${ANDROID_SERIAL}" shell am start -n "${APP_PACKAGE}/.MainActivity" >/dev/null 2>&1 \
    || "${ADB_BIN}" -s "${ANDROID_SERIAL}" shell monkey -p "${APP_PACKAGE}" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
  xcrun simctl launch "${IOS_SIM_UDID}" "${APP_PACKAGE}" >/dev/null 2>&1 || true
fi

"${ADB_BIN}" -s "${ANDROID_SERIAL}" logcat -c >/dev/null 2>&1 || true
ANDROID_PID="$("${ADB_BIN}" -s "${ANDROID_SERIAL}" shell pidof "${APP_PACKAGE}" 2>/dev/null | awk '{print $1}' | tr -d '\r' || true)"
if [[ -n "${ANDROID_PID}" ]]; then
  "${ADB_BIN}" -s "${ANDROID_SERIAL}" logcat -v time --pid "${ANDROID_PID}" > "${ANDROID_LOG}" 2>&1 &
else
  "${ADB_BIN}" -s "${ANDROID_SERIAL}" logcat -v time > "${ANDROID_LOG}" 2>&1 &
fi
ANDROID_LOG_PID=$!

xcrun simctl spawn "${IOS_SIM_UDID}" log stream --style compact --level debug --predicate 'process == "Leaf"' > "${IOS_LOG}" 2>&1 &
IOS_LOG_PID=$!

if [[ "${RECORD_SCREEN}" == "true" ]]; then
  "${ADB_BIN}" -s "${ANDROID_SERIAL}" shell screenrecord --time-limit "${ANDROID_VIDEO_LIMIT}" "${ANDROID_REMOTE_VIDEO}" >/dev/null 2>&1 &
  ANDROID_VIDEO_PID=$!
  xcrun simctl io "${IOS_SIM_UDID}" recordVideo "${IOS_VIDEO}" >/dev/null 2>&1 &
  IOS_VIDEO_PID=$!
fi

if [[ "${SESSION_SECONDS}" -gt 0 ]]; then
  echo "[phase6-cross] Running timed session for ${SESSION_SECONDS}s. Execute manual flow now..."
  sleep "${SESSION_SECONDS}"
else
  echo "[phase6-cross] Execute manual flow now."
  echo "[phase6-cross] Press Enter here when done."
  read -r _
fi
