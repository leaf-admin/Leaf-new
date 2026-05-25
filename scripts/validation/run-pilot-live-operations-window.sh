#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
API_BASE_URL="${API_BASE_URL:-${LEAF_API_BASE_URL:-https://api.147.182.204.181.sslip.io}}"
WINDOW_MINUTES="${WINDOW_MINUTES:-15}"
INTERVAL_SECONDS="${INTERVAL_SECONDS:-15}"
AUTH_TOKEN="${AUTH_TOKEN:-${LEAF_ADMIN_BEARER_TOKEN:-}}"
TOKEN_HELPER="${ROOT_DIR}/scripts/validation/lib/get-admin-bearer-token.sh"
auth_mode="provided"

if ! [[ "${WINDOW_MINUTES}" =~ ^[0-9]+$ ]] || ! [[ "${INTERVAL_SECONDS}" =~ ^[0-9]+$ ]]; then
  echo "[pilot-live-ops][error] WINDOW_MINUTES e INTERVAL_SECONDS devem ser inteiros." >&2
  exit 2
fi

if [[ "${INTERVAL_SECONDS}" -le 0 ]]; then
  echo "[pilot-live-ops][error] INTERVAL_SECONDS deve ser maior que zero." >&2
  exit 2
fi

SAMPLES=$(( (WINDOW_MINUTES * 60 + INTERVAL_SECONDS - 1) / INTERVAL_SECONDS ))
STAMP="$(date -u +"%Y-%m-%dT%H-%M-%SZ")"
RUN_DIR="${ROOT_DIR}/reports/pilot-live-ops/${STAMP}"
HEALTH_LOG="${RUN_DIR}/health-watch.log"
OPS_LOG="${RUN_DIR}/operations-watch.log"
SUMMARY_MD="${RUN_DIR}/summary.md"

mkdir -p "${RUN_DIR}"

if [[ -z "${AUTH_TOKEN}" && -x "${TOKEN_HELPER}" ]]; then
  AUTH_TOKEN="$("${TOKEN_HELPER}" "${API_BASE_URL}" 2>/dev/null || true)"
  if [[ -n "${AUTH_TOKEN}" ]]; then
    auth_mode="login"
  else
    auth_mode="absent"
  fi
elif [[ -z "${AUTH_TOKEN}" ]]; then
  auth_mode="absent"
fi

echo "[pilot-live-ops] run_dir=${RUN_DIR}"
echo "[pilot-live-ops] api_base_url=${API_BASE_URL}"
echo "[pilot-live-ops] window_minutes=${WINDOW_MINUTES}"
echo "[pilot-live-ops] interval_seconds=${INTERVAL_SECONDS}"
echo "[pilot-live-ops] admin_auth_mode=${auth_mode}"

echo "[pilot-live-ops] starting watchers..."
OUTPUT_FILE="${HEALTH_LOG}" MAX_SAMPLES="${SAMPLES}" INTERVAL_SECONDS="${INTERVAL_SECONDS}" \
  bash "${ROOT_DIR}/scripts/validation/watch-pilot-health.sh" "${API_BASE_URL}" &
health_pid=$!

OUTPUT_FILE="${OPS_LOG}" MAX_SAMPLES="${SAMPLES}" INTERVAL_SECONDS="${INTERVAL_SECONDS}" AUTH_TOKEN="${AUTH_TOKEN}" \
  bash "${ROOT_DIR}/scripts/validation/watch-pilot-operations.sh" "${API_BASE_URL}" &
ops_pid=$!

wait "${health_pid}"
wait "${ops_pid}"

health_samples="$(grep -c '^20' "${HEALTH_LOG}" || true)"
health_bad_http="$(grep -c 'code=503\|code=500\|code=000' "${HEALTH_LOG}" || true)"
health_bad_state="$(grep -c 'health=unhealthy\|health=degraded' "${HEALTH_LOG}" || true)"
health_critical="$(grep -c 'system=critical' "${HEALTH_LOG}" || true)"

ops_samples="$(grep -c '^20' "${OPS_LOG}" || true)"
ops_failures="$(grep -c 'status=FAIL' "${OPS_LOG}" || true)"
ops_activity_anomalies="$(grep -c 'activity_anomaly=yes' "${OPS_LOG}" || true)"
ops_rides_metric_anomalies="$(grep -c 'rides_metric_anomaly=yes' "${OPS_LOG}" || true)"
ops_auth_skips="$(grep -c 'observability_code=skipped' "${OPS_LOG}" || true)"

if [[ "${health_bad_http}" -eq 0 && "${health_bad_state}" -eq 0 && "${health_critical}" -eq 0 && "${ops_failures}" -eq 0 ]]; then
  window_status="PASS"
  window_decision="GO"
else
  window_status="FAIL"
  window_decision="HOLD"
fi

cat > "${SUMMARY_MD}" <<EOF
# Pilot Live Operations Window

- Status: \`${window_decision}\`
- Run dir: \`${RUN_DIR}\`
- API base URL: \`${API_BASE_URL}\`
- Window minutes: \`${WINDOW_MINUTES}\`
- Interval seconds: \`${INTERVAL_SECONDS}\`
- Admin auth mode: \`${auth_mode}\`
- Health samples: \`${health_samples}\`
- Health bad HTTP samples: \`${health_bad_http}\`
- Health bad-state samples: \`${health_bad_state}\`
- Health critical-system samples: \`${health_critical}\`
- Operations samples: \`${ops_samples}\`
- Operations failure samples: \`${ops_failures}\`
- Activity anomaly samples: \`${ops_activity_anomalies}\`
- Rides metric anomaly samples: \`${ops_rides_metric_anomalies}\`
- Auth-skipped ops samples: \`${ops_auth_skips}\`
- Health log: \`${HEALTH_LOG}\`
- Operations log: \`${OPS_LOG}\`

## Interpretation

- \`GO\`: a saúde do backend ficou estável e o watcher operacional não encontrou falha de endpoint durante a janela.
- \`HOLD\`: houve regressão de health ou falha operacional suficiente para pausar a janela assistida.
- \`activity_anomaly=yes\`: a atividade recente respondeu, mas com descrições degradadas; isso merece triagem, mesmo se a janela continuar aberta.
- \`rides_metric_anomaly=yes\`: os contadores de corridas responderam, mas a relação entre \`active_rides\` e \`total_rides\` parece incoerente; isso merece triagem de telemetria.
