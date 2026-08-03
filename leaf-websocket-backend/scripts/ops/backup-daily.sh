#!/usr/bin/env bash
set -euo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LEAF_WORKSPACE_ROOT="$(cd "$ROOT_DIR/.." && pwd -P)"
LEAF_USER_HOME="$(cd && pwd -P)"

if [[ -f "$ROOT_DIR/.env" ]]; then
  LEAF_BACKUP_ENV_EXPORTS="$(
    node "$ROOT_DIR/scripts/ops/emit-backup-env.cjs" "$ROOT_DIR/.env"
  )"
  if [[ -n "$LEAF_BACKUP_ENV_EXPORTS" ]]; then
    # Conteúdo gerado por helper versionado: chaves permitidas e valores shell-quoted.
    # shellcheck disable=SC1091
    source /dev/stdin <<<"$LEAF_BACKUP_ENV_EXPORTS"
  fi
  unset LEAF_BACKUP_ENV_EXPORTS
fi

BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/leaf}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-10}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"

if [[ "$BACKUP_ROOT" != /* ]]; then
  echo "[backup] BACKUP_ROOT deve ser absoluto" >&2
  exit 1
fi
if [[ ! "$RETENTION_DAYS" =~ ^[1-9][0-9]*$ ]] || (( RETENTION_DAYS > 3650 )); then
  echo "[backup] BACKUP_RETENTION_DAYS deve estar entre 1 e 3650" >&2
  exit 1
fi

mkdir -p "$BACKUP_ROOT"
BACKUP_ROOT="$(cd "$BACKUP_ROOT" && pwd -P)"
if [[ ! "$BACKUP_ROOT" =~ ^/[^/]+/[^/]+(/|$) ]]; then
  echo "[backup] BACKUP_ROOT amplo demais: $BACKUP_ROOT" >&2
  exit 1
fi
case "$BACKUP_ROOT" in
  "$ROOT_DIR"|"$LEAF_WORKSPACE_ROOT"|"$LEAF_USER_HOME")
    echo "[backup] BACKUP_ROOT não pode ser diretório de código, workspace ou usuário" >&2
    exit 1
    ;;
esac

REDIS_BACKUP_DIR="$BACKUP_ROOT/redis"
FIRESTORE_BACKUP_DIR="$BACKUP_ROOT/firestore"
mkdir -p "$REDIS_BACKUP_DIR" "$FIRESTORE_BACKUP_DIR"

echo "[backup] start $TIMESTAMP"

# 1) Backup Redis validado, com checksum e manifesto. Falha em vez de pular.
REDIS_TARGET="$REDIS_BACKUP_DIR/redis-$TIMESTAMP.rdb.gz"
node "$ROOT_DIR/scripts/ops/backup-redis.cjs" --out "$REDIS_TARGET"
node "$ROOT_DIR/scripts/ops/verify-redis-restore.cjs" --backup "$REDIS_TARGET"
echo "[backup] redis ok: $REDIS_TARGET"

# 2) Backup Firestore critico em JSON.gz
FIRESTORE_TARGET="$FIRESTORE_BACKUP_DIR/firestore-critical-$TIMESTAMP.json.gz"
node "$ROOT_DIR/scripts/ops/backup-firestore-critical.js" --out "$FIRESTORE_TARGET"
node "$ROOT_DIR/scripts/ops/verify-firestore-restore.cjs" --backup "$FIRESTORE_TARGET"
echo "[backup] firestore ok: $FIRESTORE_TARGET"

# 3) Limpeza por retencao
find "$REDIS_BACKUP_DIR" "$FIRESTORE_BACKUP_DIR" -type f -mtime "+$RETENTION_DAYS" -delete
echo "[backup] cleanup ok (>${RETENTION_DAYS}d)"

echo "[backup] done $TIMESTAMP"
