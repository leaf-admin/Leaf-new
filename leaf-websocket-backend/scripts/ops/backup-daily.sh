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
  set -a
  source "$ROOT_DIR/.env"
  set +a
fi

echo "[backup] start $TIMESTAMP"

# 1) Backup Redis validado, com checksum e manifesto. Falha em vez de pular.
REDIS_TARGET="$REDIS_BACKUP_DIR/redis-$TIMESTAMP.rdb.gz"
node "$ROOT_DIR/scripts/ops/backup-redis.cjs" --out "$REDIS_TARGET"
echo "[backup] redis ok: $REDIS_TARGET"

# 2) Backup Firestore critico em JSON.gz
FIRESTORE_TARGET="$FIRESTORE_BACKUP_DIR/firestore-critical-$TIMESTAMP.json.gz"
node "$ROOT_DIR/scripts/ops/backup-firestore-critical.js" --out "$FIRESTORE_TARGET"
echo "[backup] firestore ok: $FIRESTORE_TARGET"

# 3) Limpeza por retencao
find "$BACKUP_ROOT" -type f -mtime "+$RETENTION_DAYS" -delete
echo "[backup] cleanup ok (>${RETENTION_DAYS}d)"

echo "[backup] done $TIMESTAMP"
