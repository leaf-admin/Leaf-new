#!/usr/bin/env bash
set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$BACKEND_DIR"

RUNTIME_MODE="${LEAF_SERVER_RUNTIME:-modular}"
CUSTOM_ENTRY="${LEAF_SERVER_ENTRY:-}"

case "$RUNTIME_MODE" in
  modular)
    ENTRY_FILE="server.js"
    ;;
  vps)
    echo "[runtime][deprecated] LEAF_SERVER_RUNTIME=vps é legado. Use apenas para rollback temporário."
    ENTRY_FILE="server.vps.js"
    ;;
  custom)
    if [[ -z "$CUSTOM_ENTRY" ]]; then
      echo "[runtime][error] LEAF_SERVER_ENTRY é obrigatório quando LEAF_SERVER_RUNTIME=custom"
      exit 2
    fi
    ENTRY_FILE="$CUSTOM_ENTRY"
    ;;
  *)
    echo "[runtime][error] LEAF_SERVER_RUNTIME inválido: $RUNTIME_MODE (use: modular|vps|custom)"
    exit 2
    ;;
esac

if [[ ! -f "$ENTRY_FILE" ]]; then
  echo "[runtime][error] Entry file não encontrado: $ENTRY_FILE"
  exit 2
fi

if [[ "${LEAF_SKIP_RUNTIME_CONFIG_VALIDATION:-false}" != "true" ]] && [[ "${NODE_ENV:-development}" == "production" ]]; then
  echo "[runtime] validando configuração de runtime (produção)"
  node "$BACKEND_DIR/scripts/deploy/validate-runtime-config.js"
fi

echo "[runtime] mode=$RUNTIME_MODE entry=$ENTRY_FILE"
exec node "$ENTRY_FILE"
