#!/usr/bin/env bash
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOKEN_HELPER="${SCRIPT_DIR}/validation/lib/get-admin-bearer-token.sh"
BASE_URL="${1:-https://api.147.182.204.181.sslip.io}"
TIMEOUT="${TIMEOUT:-12}"
AUTH_TOKEN="${AUTH_TOKEN:-${LEAF_ADMIN_BEARER_TOKEN:-}}"
AUTH_MODE="provided"

if [[ -z "${AUTH_TOKEN}" && -x "${TOKEN_HELPER}" ]]; then
  AUTH_TOKEN="$("${TOKEN_HELPER}" "${BASE_URL}" 2>/dev/null || true)"
  if [[ -n "${AUTH_TOKEN}" ]]; then
    AUTH_MODE="login"
  else
    AUTH_MODE="absent"
  fi
elif [[ -z "${AUTH_TOKEN}" ]]; then
  AUTH_MODE="absent"
fi

PASS=0
FAIL=0

curl_code() {
  local url="$1"
  shift || true
  curl -sS -m "${TIMEOUT}" -o /tmp/leaf-health.json -w "%{http_code}" "$@" "${url}" 2>/dev/null || echo "000"
}

auth_args() {
  if [[ -n "${AUTH_TOKEN}" ]]; then
    printf '%s\n' "-H" "Authorization: Bearer ${AUTH_TOKEN}"
    return
  fi
  return 0
}

check_json_endpoint() {
  local path="$1"
  local expected="${2:-200}"
  local url="${BASE_URL}${path}"
  local code

  code="$(curl_code "${url}")"
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

check_auth_endpoint() {
  local path="$1"
  local url="${BASE_URL}${path}"
  local code

  if [[ -n "${AUTH_TOKEN}" ]]; then
    code="$(curl_code "${url}" -H "Authorization: Bearer ${AUTH_TOKEN}")"
    if [[ "${code}" == "200" ]]; then
      echo "✅ ${path} autenticado (${code})"
      PASS=$((PASS + 1))
      return
    fi

    echo "❌ ${path} autenticado (esperado 200, recebido ${code})"
    head -c 180 /tmp/leaf-health.json 2>/dev/null || true
    echo
    FAIL=$((FAIL + 1))
    return
  fi

  code="$(curl_code "${url}")"
  if [[ "${code}" == "401" || "${code}" == "403" ]]; then
    echo "✅ ${path} protegido por autenticação (${code})"
    PASS=$((PASS + 1))
    return
  fi

  if [[ "${code}" == "200" ]]; then
    echo "✅ ${path} aberto (${code})"
    PASS=$((PASS + 1))
    return
  fi

  echo "❌ ${path} protegido (esperado 200/401/403, recebido ${code})"
  head -c 180 /tmp/leaf-health.json 2>/dev/null || true
  echo
  FAIL=$((FAIL + 1))
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
echo "🔐 Admin auth mode: ${AUTH_MODE}"
echo

# Core health
check_json_endpoint "/health" "200"
check_json_endpoint "/health/quick" "200"
check_json_endpoint "/health/readiness" "200"
check_json_endpoint "/health/liveness" "200"
check_json_endpoint "/api/health" "200"

# APIs usadas por app/dashboard
check_auth_endpoint "/api/rides/stats?period=today"
check_json_endpoint "/api/metrics/overview" "200"
check_auth_endpoint "/api/metrics/rides/daily"
check_auth_endpoint "/api/metrics/financial/rides?period=today"
check_auth_endpoint "/api/metrics/financial/operational-fee?period=today"
check_auth_endpoint "/api/metrics/observability"
check_auth_endpoint "/api/map/locations?type=all"
check_auth_endpoint "/api/drivers/applications?page=1&limit=5"
check_auth_endpoint "/api/activity/recent"

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
