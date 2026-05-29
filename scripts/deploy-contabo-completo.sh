#!/usr/bin/env bash

# Canonical root-level wrapper for Contabo deploys.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CANONICAL_SCRIPT="$ROOT_DIR/leaf-websocket-backend/scripts/deploy-contabo-docker.sh"

if [[ ! -f "$CANONICAL_SCRIPT" ]]; then
  echo "[error] Script canônico não encontrado: $CANONICAL_SCRIPT"
  exit 2
fi

if [[ ! -x "$CANONICAL_SCRIPT" ]]; then
  chmod +x "$CANONICAL_SCRIPT" 2>/dev/null || true
fi

echo "[info] Encaminhando deploy para $CANONICAL_SCRIPT"
exec "$CANONICAL_SCRIPT" "$@"
