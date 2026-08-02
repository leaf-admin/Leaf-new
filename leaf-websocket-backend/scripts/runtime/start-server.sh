#!/usr/bin/env bash
set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$BACKEND_DIR"

NODE_ENV_NORMALIZED="$(printf '%s' "${NODE_ENV:-development}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
ENTRY_FILE="server.js"

if [[ "$NODE_ENV_NORMALIZED" == "production" ]] && [[ "${LEAF_SKIP_RUNTIME_CONFIG_VALIDATION:-false}" == "true" ]]; then
  echo "[runtime][error] Validação de configuração não pode ser ignorada em produção"
  exit 2
fi

if [[ ! -f "$ENTRY_FILE" ]]; then
  echo "[runtime][error] Entry file não encontrado: $ENTRY_FILE"
  exit 2
fi

if [[ "${LEAF_SKIP_RUNTIME_CONFIG_VALIDATION:-false}" != "true" ]] && [[ "$NODE_ENV_NORMALIZED" == "production" ]]; then
  echo "[runtime] validando configuração de runtime (produção)"
  node "$BACKEND_DIR/scripts/deploy/validate-runtime-config.js"
fi

echo "[runtime] entry=$ENTRY_FILE"
exec node "$ENTRY_FILE"
