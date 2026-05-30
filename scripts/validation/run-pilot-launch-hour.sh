#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
API_BASE_URL="${API_BASE_URL:-${LEAF_API_BASE_URL:-https://api.leaf.app.br}}"
HEALTH_URL="${HEALTH_URL:-${LEAF_HEALTH_URL:-${API_BASE_URL}/health}}"
WINDOW_MINUTES="${WINDOW_MINUTES:-15}"
INTERVAL_SECONDS="${INTERVAL_SECONDS:-15}"

if ! [[ "${WINDOW_MINUTES}" =~ ^[0-9]+$ ]] || ! [[ "${INTERVAL_SECONDS}" =~ ^[0-9]+$ ]]; then
  echo "[launch-hour][error] WINDOW_MINUTES e INTERVAL_SECONDS devem ser inteiros." >&2
  exit 2
fi

if [[ "${INTERVAL_SECONDS}" -le 0 ]]; then
  echo "[launch-hour][error] INTERVAL_SECONDS deve ser maior que zero." >&2
  exit 2
fi

SAMPLES=$(( (WINDOW_MINUTES * 60 + INTERVAL_SECONDS - 1) / INTERVAL_SECONDS ))
STAMP="$(date -u +"%Y-%m-%dT%H-%M-%SZ")"
RUN_DIR="${ROOT_DIR}/reports/pilot-launch-hour/${STAMP}"
PRECHECK_LOG="${RUN_DIR}/preflight.log"
DEEP_LOG="${RUN_DIR}/deep-check.log"
WATCH_LOG="${RUN_DIR}/watch.log"
SUMMARY_MD="${RUN_DIR}/summary.md"

mkdir -p "${RUN_DIR}"

echo "[launch-hour] run_dir=${RUN_DIR}"
echo "[launch-hour] api_base_url=${API_BASE_URL}"
echo "[launch-hour] health_url=${HEALTH_URL}"
echo "[launch-hour] window_minutes=${WINDOW_MINUTES}"
echo "[launch-hour] interval_seconds=${INTERVAL_SECONDS}"

echo
echo "[launch-hour] 1/3 preflight"
if LEAF_HEALTH_URL="${HEALTH_URL}" bash "${ROOT_DIR}/scripts/validation/run-pilot-controlled-preflight.sh" | tee "${PRECHECK_LOG}"; then
  preflight_status="PASS"
else
  preflight_status="FAIL"
fi

if [[ "${preflight_status}" != "PASS" ]]; then
  cat > "${SUMMARY_MD}" <<EOF
# Pilot Launch Hour

- Status: \`HOLD\`
- Reason: preflight failed
- Run dir: \`${RUN_DIR}\`
- Preflight log: \`${PRECHECK_LOG}\`
EOF
  echo "[launch-hour] HOLD: preflight failed"
  exit 1
fi

echo
echo "[launch-hour] 2/3 deep check"
if API_BASE_URL="${API_BASE_URL}" HEALTH_URL="${HEALTH_URL}" bash "${ROOT_DIR}/scripts/validation/run-pilot-controlled-deep-check.sh" | tee "${DEEP_LOG}"; then
  deep_status="PASS"
else
  deep_status="FAIL"
fi

if [[ "${deep_status}" != "PASS" ]]; then
  cat > "${SUMMARY_MD}" <<EOF
# Pilot Launch Hour

- Status: \`HOLD\`
- Reason: deep check failed
- Run dir: \`${RUN_DIR}\`
- Preflight log: \`${PRECHECK_LOG}\`
- Deep check log: \`${DEEP_LOG}\`
EOF
  echo "[launch-hour] HOLD: deep check failed"
  exit 1
fi

echo
echo "[launch-hour] 3/3 watch window"
OUTPUT_FILE="${WATCH_LOG}" MAX_SAMPLES="${SAMPLES}" INTERVAL_SECONDS="${INTERVAL_SECONDS}" \
  bash "${ROOT_DIR}/scripts/validation/watch-pilot-health.sh" "${API_BASE_URL}"

total_samples="$(grep -c '^20' "${WATCH_LOG}" || true)"
bad_http_samples="$(grep -c 'code=503\|code=500\|code=000' "${WATCH_LOG}" || true)"
bad_health_samples="$(grep -c 'health=unhealthy\|health=degraded' "${WATCH_LOG}" || true)"
critical_system_samples="$(grep -c 'system=critical' "${WATCH_LOG}" || true)"

if [[ "${bad_http_samples}" -eq 0 && "${bad_health_samples}" -eq 0 && "${critical_system_samples}" -eq 0 ]]; then
  launch_status="PASS"
  launch_decision="GO"
else
  launch_status="FAIL"
  launch_decision="HOLD"
fi

cat > "${SUMMARY_MD}" <<EOF
# Pilot Launch Hour

- Status: \`${launch_decision}\`
- Run dir: \`${RUN_DIR}\`
- API base URL: \`${API_BASE_URL}\`
- Health URL: \`${HEALTH_URL}\`
- Window minutes: \`${WINDOW_MINUTES}\`
- Interval seconds: \`${INTERVAL_SECONDS}\`
- Samples observed: \`${total_samples}\`
- Bad HTTP samples: \`${bad_http_samples}\`
- Bad health samples: \`${bad_health_samples}\`
- Critical system samples: \`${critical_system_samples}\`
- Preflight log: \`${PRECHECK_LOG}\`
- Deep check log: \`${DEEP_LOG}\`
- Watch log: \`${WATCH_LOG}\`

## Interpretation

- \`GO\`: preflight ok, deep check ok e nenhuma amostra da janela curta caiu para \`503\`, \`unhealthy\` ou \`system=critical\`.
- \`HOLD\`: houve regressão operacional durante a janela curta e a abertura deve ser pausada.
EOF

echo
echo "[launch-hour] decision=${launch_decision}"
echo "[launch-hour] summary=${SUMMARY_MD}"

if [[ "${launch_status}" != "PASS" ]]; then
  exit 1
fi
