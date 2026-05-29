#!/usr/bin/env bash

# Canonical Contabo deploy entrypoint.
# The old deploy-hostinger-docker.sh name is kept as the implementation for
# compatibility with existing runbooks and operator muscle memory.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CANONICAL_SCRIPT="$SCRIPT_DIR/deploy-hostinger-docker.sh"

if [[ ! -f "$CANONICAL_SCRIPT" ]]; then
  echo "[error] Script compatível não encontrado: $CANONICAL_SCRIPT"
  exit 2
fi

if [[ ! -x "$CANONICAL_SCRIPT" ]]; then
  chmod +x "$CANONICAL_SCRIPT" 2>/dev/null || true
fi

echo "[info] Executando deploy Contabo via $CANONICAL_SCRIPT"
exec "$CANONICAL_SCRIPT" "$@"
