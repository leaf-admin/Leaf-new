#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

echo "[firebase-rules-release] apply-rules-manual.sh delega ao release gate canônico."
exec "$SCRIPT_DIR/deploy-rules.sh" "$@"
