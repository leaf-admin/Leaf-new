#!/bin/bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKEND_DIR="$PROJECT_ROOT"
WORKSPACE_ROOT="$(cd "$PROJECT_ROOT/.." && pwd)"

VPS_USER="${VPS_USER:-root}"
VPS_IP="${VPS_IP:-${1:-}}"
VPS_PATH="${VPS_PATH:-/opt/leaf-realtime-secondary}"
SSH_KEY="${SSH_KEY:-${CONTABO_KEY:-}}"
BASE_ENV_SOURCE="${BASE_ENV_SOURCE:-$BACKEND_DIR/.tmp-contabo.env}"
PRIMARY_PUBLIC_API_URL="${PRIMARY_PUBLIC_API_URL:-https://api.leaf.app.br}"
PRIMARY_PUBLIC_SOCKET_URL="${PRIMARY_PUBLIC_SOCKET_URL:-https://socket.leaf.app.br}"
PRIMARY_REDIS_PASSWORD="${PRIMARY_REDIS_PASSWORD-}"
PRIMARY_REDIS_DB="${PRIMARY_REDIS_DB:-0}"
PRIMARY_REDIS_HOST="${PRIMARY_REDIS_HOST:-host.docker.internal}"
PRIMARY_REDIS_PORT="${PRIMARY_REDIS_PORT:-6381}"

if [ -z "$VPS_IP" ]; then
    echo "Uso: VPS_IP=<ip-do-segundo-host> $0" >&2
    exit 1
fi

if [ -z "$SSH_KEY" ] || [ ! -f "$SSH_KEY" ]; then
    echo "Configure SSH_KEY ou CONTABO_KEY com uma chave SSH válida" >&2
    exit 1
fi

if [ ! -f "$BACKEND_DIR/docker-compose.realtime-secondary.yml" ]; then
    echo "docker-compose.realtime-secondary.yml não encontrado" >&2
    exit 1
fi

if [ ! -f "$BASE_ENV_SOURCE" ]; then
    echo "Arquivo base de ambiente não encontrado: $BASE_ENV_SOURCE" >&2
    exit 1
fi

if [ -z "$PRIMARY_REDIS_PASSWORD" ]; then
    PRIMARY_REDIS_PASSWORD="$(sed -n 's/^REDIS_PASSWORD=//p' "$BASE_ENV_SOURCE" | head -n 1)"
fi

if [ -z "$PRIMARY_REDIS_PASSWORD" ]; then
    echo "PRIMARY_REDIS_PASSWORD obrigatório (via env ou REDIS_PASSWORD em $BASE_ENV_SOURCE)" >&2
    exit 1
fi

TMP_ENV="$(mktemp /tmp/leaf-secondary-env.XXXXXX)"
TMP_TARBALL="$(mktemp /tmp/leaf-secondary-code.XXXXXX.tar.gz)"

cleanup() {
    rm -f "$TMP_ENV" "$TMP_TARBALL"
}
trap cleanup EXIT

grep -Ev '^(REDIS_HOST|REDIS_PORT|REDIS_PASSWORD|REDIS_DB|REDIS_URL|RUNTIME_ROLE|ENABLE_EMBEDDED_LISTENER_WORKERS|RUNTIME_ENABLE_QUEUE_WORKER|ENABLE_DRIVER_POOL_MONITOR|ENABLE_RUNTIME_DEMAND_NOTIFICATION_SERVICE|ENABLE_RUNTIME_DASHBOARD_WEBSOCKET|ENABLE_RUNTIME_CLEANUP_JOB|SERVER_URL|WOOVI_WEBHOOK_URL)=' "$BASE_ENV_SOURCE" >"$TMP_ENV"
cat >>"$TMP_ENV" <<EOF
RUNTIME_ROLE=gateway
ENABLE_EMBEDDED_LISTENER_WORKERS=false
RUNTIME_ENABLE_QUEUE_WORKER=false
ENABLE_DRIVER_POOL_MONITOR=false
ENABLE_RUNTIME_DEMAND_NOTIFICATION_SERVICE=false
ENABLE_RUNTIME_DASHBOARD_WEBSOCKET=false
REDIS_HOST=${PRIMARY_REDIS_HOST}
REDIS_PORT=${PRIMARY_REDIS_PORT}
REDIS_PASSWORD=${PRIMARY_REDIS_PASSWORD}
REDIS_DB=${PRIMARY_REDIS_DB}
REDIS_URL=redis://:${PRIMARY_REDIS_PASSWORD}@${PRIMARY_REDIS_HOST}:${PRIMARY_REDIS_PORT}/${PRIMARY_REDIS_DB}
PRIMARY_REDIS_HOST=${PRIMARY_REDIS_HOST}
PRIMARY_REDIS_PORT=${PRIMARY_REDIS_PORT}
PRIMARY_REDIS_PASSWORD=${PRIMARY_REDIS_PASSWORD}
PRIMARY_REDIS_DB=${PRIMARY_REDIS_DB}
SERVER_URL=${PRIMARY_PUBLIC_API_URL}
WOOVI_WEBHOOK_URL=${PRIMARY_PUBLIC_API_URL}/api/woovi/webhook
SECONDARY_PUBLIC_BIND_IP=0.0.0.0
PRIMARY_PUBLIC_SOCKET_URL=${PRIMARY_PUBLIC_SOCKET_URL}
EOF

tar --exclude='node_modules' \
    --exclude='.git' \
    --exclude='logs' \
    --exclude='coverage' \
    --exclude='*.log' \
    --exclude='.env*' \
    --exclude='firebase-credentials.json' \
    -czf "$TMP_TARBALL" \
    -C "$BACKEND_DIR" .

ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$VPS_USER@$VPS_IP" "mkdir -p $VPS_PATH/logs"
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no "$BACKEND_DIR/docker-compose.realtime-secondary.yml" "$VPS_USER@$VPS_IP:$VPS_PATH/"
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no "$BACKEND_DIR/Dockerfile" "$VPS_USER@$VPS_IP:$VPS_PATH/"
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no "$BACKEND_DIR/package.json" "$VPS_USER@$VPS_IP:$VPS_PATH/"
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no "$BACKEND_DIR/package-lock.json" "$VPS_USER@$VPS_IP:$VPS_PATH/" 2>/dev/null || true
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no "$BACKEND_DIR/firebase-credentials.json" "$VPS_USER@$VPS_IP:$VPS_PATH/"
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no "$TMP_ENV" "$VPS_USER@$VPS_IP:$VPS_PATH/.env.realtime-secondary"
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no "$TMP_TARBALL" "$VPS_USER@$VPS_IP:$VPS_PATH/leaf-secondary-code.tar.gz"

ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$VPS_USER@$VPS_IP" <<EOF
set -euo pipefail
cd "$VPS_PATH"
tar -xzf leaf-secondary-code.tar.gz
rm -f leaf-secondary-code.tar.gz
docker compose -f docker-compose.realtime-secondary.yml up -d --build
sleep 12
docker compose -f docker-compose.realtime-secondary.yml ps
curl -fsS http://127.0.0.1:3001/health/liveness
EOF

echo "Deploy do segundo host realtime concluído em $VPS_IP"
