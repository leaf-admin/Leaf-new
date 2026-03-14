#!/usr/bin/env bash
set -u

BASE_URL="${1:-http://147.182.204.181:3001}"
TIMEOUT="${TIMEOUT:-12}"

PASS=0
FAIL=0

check_json_endpoint() {
  local path="$1"
  local expected="${2:-200}"
  local url="${BASE_URL}${path}"
  local code

  code="$(curl -sS -m "${TIMEOUT}" -o /tmp/leaf-health.json -w "%{http_code}" "${url}" 2>/dev/null || echo "000")"
  if [[ "${code}" == "${expected}" ]]; then
    echo "✅ ${path} (${code})"
    PASS=$((PASS + 1))
  else
    echo "❌ ${path} (esperado ${expected}, recebido ${code})"
    head -c 180 /tmp/leaf-health.json 2>/dev/null || true
    echo
    FAIL=$((FAIL + 1))
  fi
}

check_contains() {
  local path="$1"
  local pattern="$2"
  local url="${BASE_URL}${path}"
  local body

  body="$(curl -sS -m "${TIMEOUT}" "${url}" 2>/dev/null || true)"
  if echo "${body}" | grep -q "${pattern}"; then
    echo "✅ ${path} contém '${pattern}'"
    PASS=$((PASS + 1))
  else
    echo "❌ ${path} sem padrão '${pattern}'"
    echo "${body}" | head -c 220
    echo
    FAIL=$((FAIL + 1))
  fi
}

check_socketio_transport() {
  local url="${BASE_URL}/socket.io/?EIO=4&transport=polling"
  local body
  body="$(curl -sS -m "${TIMEOUT}" "${url}" 2>/dev/null || true)"

  if echo "${body}" | grep -q "sid"; then
    echo "✅ /socket.io polling ativo"
    PASS=$((PASS + 1))
    return
  fi

  # Em produção, quando SOCKET_ALLOW_POLLING=false, o retorno esperado é "Transport unknown".
  if echo "${body}" | grep -q "Transport unknown"; then
    echo "✅ /socket.io websocket-only (polling desabilitado em produção)"
    PASS=$((PASS + 1))
    return
  fi

  echo "❌ /socket.io handshake inválido"
  echo "${body}" | head -c 220
  echo
  FAIL=$((FAIL + 1))
}

echo "🔎 Healthcheck VPS: ${BASE_URL}"
echo

# Core health
check_json_endpoint "/health" "200"
check_json_endpoint "/health/quick" "200"
check_json_endpoint "/health/readiness" "200"
check_json_endpoint "/health/liveness" "200"
check_json_endpoint "/api/health" "200"

# APIs usadas por app/dashboard
check_json_endpoint "/api/rides/stats?period=today" "200"
check_json_endpoint "/api/metrics/overview" "200"
check_json_endpoint "/api/metrics/rides/daily" "200"
check_json_endpoint "/api/metrics/financial/rides?period=today" "200"
check_json_endpoint "/api/metrics/financial/operational-fee?period=today" "200"
check_json_endpoint "/api/metrics/observability" "200"
check_json_endpoint "/api/map/locations?type=all" "200"
check_json_endpoint "/api/drivers/applications?page=1&limit=5" "200"
check_json_endpoint "/api/activity/recent" "200"

# KYC
check_json_endpoint "/api/kyc/health" "200"
check_json_endpoint "/api/workers/health" "200"

# WebSocket handshake (socket.io engine)
check_socketio_transport

echo
echo "Resumo: ${PASS} OK | ${FAIL} falhas"
if [[ "${FAIL}" -gt 0 ]]; then
  exit 1
fi
