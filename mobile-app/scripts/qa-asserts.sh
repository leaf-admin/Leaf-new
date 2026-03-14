#!/usr/bin/env bash
set -euo pipefail

ARTIFACTS_DIR="${1:-}"
if [[ -z "$ARTIFACTS_DIR" || ! -d "$ARTIFACTS_DIR" ]]; then
  echo "usage: $0 <artifacts_dir>"
  exit 1
fi

MIN_COMPLETED_RIDES="${MIN_COMPLETED_RIDES:-1}"
MAX_ALLOWED_ERRORS="${MAX_ALLOWED_ERRORS:-20}"
MAX_CRITICAL_LOGS="${MAX_CRITICAL_LOGS:-5}"

HEALTH_FILE="$ARTIFACTS_DIR/backend-health.json"
HANDSHAKE_FILE="$ARTIFACTS_DIR/backend-socketio-handshake.json"
SIM_REPORT="$ARTIFACTS_DIR/simulated-ride.json"
LOADTEST_REPORT="$ARTIFACTS_DIR/load-test-report.json"
LOGCAT_FILE="$ARTIFACTS_DIR/android-logcat.txt"

RESULT_JSON="$ARTIFACTS_DIR/qa-report.json"
RESULT_MD="$ARTIFACTS_DIR/qa-report.md"

STATUS="PASS"
FAIL_REASONS=()

health_ok="false"
if [[ -f "$HEALTH_FILE" ]]; then
  health_ok="$(node -e "const fs=require('fs');try{const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const s=String(j.status||'').toLowerCase();const ok=(s==='healthy'||s==='ok'||s==='warning'||j.success===true);process.stdout.write(ok?'true':'false')}catch{process.stdout.write('false')}" "$HEALTH_FILE")"
fi
if [[ "$health_ok" != "true" ]]; then
  STATUS="FAIL"
  FAIL_REASONS+=("backend_health_failed")
fi

handshake_ok="false"
if [[ -f "$HANDSHAKE_FILE" ]]; then
  handshake_ok="$(node -e "const fs=require('fs');try{const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(j.ok?'true':'false')}catch{process.stdout.write('false')}" "$HANDSHAKE_FILE")"
fi
if [[ "$handshake_ok" != "true" ]]; then
  STATUS="FAIL"
  FAIL_REASONS+=("socketio_handshake_failed")
fi

completed_rides=0
total_errors=999999
success_rate="0%"
if [[ -f "$SIM_REPORT" ]]; then
  sim_ok="$(node -e "const fs=require('fs');try{const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(j.ok?'true':'false')}catch{process.stdout.write('false')}" "$SIM_REPORT")"
  if [[ "$sim_ok" == "true" ]]; then
    completed_rides=1
    total_errors=0
    success_rate="100%"
  else
    STATUS="FAIL"
    FAIL_REASONS+=("simulated_ride_flow_failed")
    total_errors=1
  fi
elif [[ -f "$LOADTEST_REPORT" ]]; then
  completed_rides="$(node -e "const fs=require('fs');try{const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(String(j.summary?.completedRides??0))}catch{process.stdout.write('0')}" "$LOADTEST_REPORT")"
  total_errors="$(node -e "const fs=require('fs');try{const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(String(j.summary?.totalErrors??999999))}catch{process.stdout.write('999999')}" "$LOADTEST_REPORT")"
  success_rate="$(node -e "const fs=require('fs');try{const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(String(j.summary?.successRate??'0%'))}catch{process.stdout.write('0%')}" "$LOADTEST_REPORT")"
else
  STATUS="FAIL"
  FAIL_REASONS+=("simulation_report_missing")
fi

if (( completed_rides < MIN_COMPLETED_RIDES )); then
  STATUS="FAIL"
  FAIL_REASONS+=("completed_rides_below_threshold")
fi

if (( total_errors > MAX_ALLOWED_ERRORS )); then
  STATUS="FAIL"
  FAIL_REASONS+=("too_many_backend_errors")
fi

critical_logs=0
if [[ -f "$LOGCAT_FILE" ]]; then
  critical_logs="$( (rg -n "FATAL EXCEPTION|TypeError:|UnhandledPromiseRejection|WebSocketManager] Erro de conexão WebSocket|No bundle URL present" "$LOGCAT_FILE" || true) | wc -l | tr -d ' ')"
fi
if (( critical_logs > MAX_CRITICAL_LOGS )); then
  STATUS="FAIL"
  FAIL_REASONS+=("too_many_critical_mobile_logs")
fi

node - "$RESULT_JSON" "$STATUS" "$health_ok" "$handshake_ok" "$completed_rides" "$total_errors" "$success_rate" "$critical_logs" "${FAIL_REASONS[*]:-}" <<'NODE'
const fs = require('fs');
const [,,out,status,healthOk,handshakeOk,completed,totalErrors,successRate,critical,reasons] = process.argv;
const payload = {
  generatedAt: new Date().toISOString(),
  status,
  checks: {
    backendHealth: healthOk === 'true',
    socketHandshake: handshakeOk === 'true',
    completedRides: Number(completed),
    totalBackendErrors: Number(totalErrors),
    successRate,
    criticalMobileLogs: Number(critical)
  },
  failReasons: reasons ? reasons.split(' ').filter(Boolean) : []
};
fs.writeFileSync(out, JSON.stringify(payload, null, 2));
NODE

{
  echo "# QA Report"
  echo
  echo "- Status: **$STATUS**"
  echo "- Backend /health: $health_ok"
  echo "- Socket handshake: $handshake_ok"
  echo "- Corridas completadas (simulação): $completed_rides"
  echo "- Erros backend (simulação): $total_errors"
  echo "- Taxa de sucesso (simulação): $success_rate"
  echo "- Logs críticos Android: $critical_logs"
  if [[ "${#FAIL_REASONS[@]}" -gt 0 ]]; then
    echo "- Falhas: ${FAIL_REASONS[*]}"
  fi
} > "$RESULT_MD"

if [[ "$STATUS" != "PASS" ]]; then
  echo "[qa][assert] FAIL: $(IFS=,; echo "${FAIL_REASONS[*]}")"
  exit 2
fi

echo "[qa][assert] PASS"
