#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/leaf}"
REDIS_BACKUP_DIR="$BACKUP_ROOT/redis"
FIRESTORE_BACKUP_DIR="$BACKUP_ROOT/firestore"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-10}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"

mkdir -p "$REDIS_BACKUP_DIR" "$FIRESTORE_BACKUP_DIR"

if [[ -f "$ROOT_DIR/.env" ]]; then
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
fi

echo "[backup] start $TIMESTAMP"

# 1) Backup Redis em formato RDB portavel
REDIS_TARGET="$REDIS_BACKUP_DIR/redis-$TIMESTAMP.rdb"
if command -v redis-cli >/dev/null 2>&1; then
  if [[ -n "${REDIS_HOST:-}" && -n "${REDIS_PORT:-}" && -n "${REDIS_PASSWORD:-}" ]]; then
    redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" -a "$REDIS_PASSWORD" --rdb "$REDIS_TARGET" >/dev/null
    gzip -f "$REDIS_TARGET"
    echo "[backup] redis ok: ${REDIS_TARGET}.gz"
  elif [[ -n "${REDIS_URL:-}" ]]; then
    redis-cli -u "$REDIS_URL" --rdb "$REDIS_TARGET" >/dev/null
    gzip -f "$REDIS_TARGET"
    echo "[backup] redis ok: ${REDIS_TARGET}.gz"
  else
    echo "[backup] redis skipped: REDIS_URL ausente"
  fi
else
  echo "[backup] redis skipped: redis-cli nao encontrado"
fi

# 2) Backup Firestore critico em JSON.gz
FIRESTORE_TARGET="$FIRESTORE_BACKUP_DIR/firestore-critical-$TIMESTAMP.json.gz"
node "$ROOT_DIR/scripts/ops/backup-firestore-critical.js" --out "$FIRESTORE_TARGET"
echo "[backup] firestore ok: $FIRESTORE_TARGET"

# 3) Limpeza por retencao
find "$BACKUP_ROOT" -type f -mtime "+$RETENTION_DAYS" -delete
echo "[backup] cleanup ok (>${RETENTION_DAYS}d)"

echo "[backup] done $TIMESTAMP"
