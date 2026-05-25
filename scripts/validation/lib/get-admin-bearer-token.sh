#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${1:-${API_BASE_URL:-${LEAF_API_BASE_URL:-https://api.147.182.204.181.sslip.io}}}"
EXISTING_TOKEN="${AUTH_TOKEN:-${LEAF_ADMIN_BEARER_TOKEN:-}}"
AUTO_LOGIN_ENABLED="${AUTO_LOGIN_ADMIN_TOKEN:-true}"
LOGIN_EMAIL="${ADMIN_AUTH_EMAIL:-${TEST_ADMIN_EMAIL:-admin@leaf.com}}"
LOGIN_PASSWORD="${ADMIN_AUTH_PASSWORD:-${TEST_ADMIN_PASSWORD:-admin123}}"
TIMEOUT="${TIMEOUT:-15}"
AUTO_LOGIN_ENABLED_NORMALIZED="$(printf '%s' "${AUTO_LOGIN_ENABLED}" | tr '[:upper:]' '[:lower:]')"

if [[ -n "${EXISTING_TOKEN}" ]]; then
  printf '%s\n' "${EXISTING_TOKEN}"
  exit 0
fi

if [[ "${AUTO_LOGIN_ENABLED_NORMALIZED}" != "true" ]]; then
  exit 1
fi

response_file="$(mktemp)"
cleanup() {
  rm -f "${response_file}"
}
trap cleanup EXIT

http_code="$(curl -sS -m "${TIMEOUT}" -o "${response_file}" -w '%{http_code}' \
  -X POST "${API_BASE_URL}/api/admin/auth/login" \
  -H 'Content-Type: application/json' \
  --data "{\"email\":\"${LOGIN_EMAIL}\",\"password\":\"${LOGIN_PASSWORD}\"}" \
  2>/dev/null || echo '000')"

if [[ "${http_code}" != "200" ]]; then
  exit 1
fi

token="$(jq -r '.accessToken // empty' "${response_file}" 2>/dev/null || true)"
if [[ -z "${token}" ]]; then
  exit 1
fi

printf '%s\n' "${token}"
