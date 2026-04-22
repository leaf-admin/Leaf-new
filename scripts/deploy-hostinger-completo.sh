#!/usr/bin/env bash

# Legacy wrapper kept for compatibility.
# Canonical deploy script: leaf-websocket-backend/scripts/deploy-hostinger-docker.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CANONICAL_SCRIPT="$ROOT_DIR/leaf-websocket-backend/scripts/deploy-hostinger-docker.sh"

echo "[deprecated] scripts/deploy-hostinger-completo.sh"
echo "[info] Este script legado com senha hardcoded foi desativado por segurança."
echo "[info] Use o deploy canônico baseado em SSH key."

if [[ ! -x "$CANONICAL_SCRIPT" ]]; then
  chmod +x "$CANONICAL_SCRIPT" 2>/dev/null || true
fi

if [[ ! -f "$CANONICAL_SCRIPT" ]]; then
  echo "[error] Script canônico não encontrado: $CANONICAL_SCRIPT"
  exit 2
fi

exec "$CANONICAL_SCRIPT" "$@"
