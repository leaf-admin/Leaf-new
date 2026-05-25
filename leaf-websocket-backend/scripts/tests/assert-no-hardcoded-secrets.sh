#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR/.."

FAILURES=0

fail() {
  echo "[secret-guard][fail] $1"
  FAILURES=$((FAILURES + 1))
}

assert_no_match() {
  local pattern="$1"
  local target="$2"
  local label="$3"

  if rg -n "$pattern" "$target" >/dev/null 2>&1; then
    fail "$label em $target"
  fi
}

# Arquivo sensível não pode mais existir no workspace.
if [[ -f "config/firebase/gradle.properties" ]]; then
  fail "config/firebase/gradle.properties ainda está rastreado pelo Git"
fi

# Guard rails para evitar regressão dos vazamentos já encontrados.
assert_no_match 'WOOVI_APP_ID\s*=\s*["'\''][^"'\'']{20,}["'\'']' \
  "leaf-websocket-backend/test-woovi-curl.sh" \
  "WOOVI_APP_ID hardcoded"
assert_no_match 'WOOVI_API_TOKEN\s*=\s*["'\''][^"'\'']{20,}["'\'']' \
  "leaf-websocket-backend/test-woovi-curl.sh" \
  "WOOVI_API_TOKEN hardcoded"
assert_no_match "WOOVI_API_TOKEN\\s*=\\s*process\\.env\\.WOOVI_API_TOKEN\\s*\\|\\|" \
  "leaf-websocket-backend/scripts/fix-woovi-webhook.js" \
  "fallback inseguro de WOOVI_API_TOKEN"
assert_no_match "leaf_redis_2024" \
  "leaf-websocket-backend/docker-compose.ops-workers.yml" \
  "senha Redis default insegura"
assert_no_match "leaf_redis_2024" \
  "leaf-websocket-backend/utils/docker-detector.js" \
  "fallback Redis hardcoded"
assert_no_match 'CORS_ORIGIN=\*' \
  "leaf-websocket-backend/docker-compose.hostinger.yml" \
  "CORS wildcard em compose de produção"
assert_no_match 'JWT_SECRET=\$\{JWT_SECRET:-' \
  "leaf-websocket-backend/docker-compose.hostinger.yml" \
  "fallback inseguro para JWT_SECRET"
assert_no_match "JWT_SECRET\\s*=\\s*['\"][^'\"]+['\"]" \
  "scripts/maintenance/jwt-generator.js" \
  "JWT secret hardcoded em script auxiliar"
assert_no_match "JWT_SECRET\\s*=\\s*process\\.env\\.JWT_SECRET\\s*\\|\\|" \
  "scripts/maintenance/server-complete.js" \
  "fallback inseguro de JWT secret em server-complete"
assert_no_match "JWT_SECRET\\s*=\\s*process\\.env\\.JWT_SECRET\\s*\\|\\|" \
  "scripts/maintenance/server-complete-final.js" \
  "fallback inseguro de JWT secret em server-complete-final"
assert_no_match 'PRIMARY_REDIS_PASSWORD="\$\{PRIMARY_REDIS_PASSWORD:-' \
  "leaf-websocket-backend/scripts/deploy/deploy-secondary-realtime-host.sh" \
  "fallback inseguro para senha redis no deploy secondary"

if [[ "$FAILURES" -gt 0 ]]; then
  echo "[secret-guard] falhou com $FAILURES problema(s)."
  exit 1
fi

echo "[secret-guard] ok"
