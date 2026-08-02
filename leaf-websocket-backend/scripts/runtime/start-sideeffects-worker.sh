#!/usr/bin/env bash
set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$BACKEND_DIR"

export RUNTIME_ROLE="${RUNTIME_ROLE:-sideeffects}"

if [[ "${LEAF_SKIP_RUNTIME_CONFIG_VALIDATION:-false}" != "true" ]] && [[ "${NODE_ENV:-development}" == "production" ]]; then
  echo "[runtime] validando configuração do sideeffects-worker (produção)"
  node "$BACKEND_DIR/scripts/deploy/validate-runtime-config.js"
fi

echo "[runtime] role=$RUNTIME_ROLE entry=workers/listener-worker.js"
exec node workers/listener-worker.js
