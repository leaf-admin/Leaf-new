#!/usr/bin/env bash
set -euo pipefail

# Modular production rollout for the Contabo host.
#
# This script never tears down the compose project, Redis, or named volumes.
# It replaces gateways one at a time, waits for health, then updates workers.
#
# Required:
#   CONFIRM_PRODUCTION_DEPLOY=true
#
# Optional:
#   CONTABO_HOST=<host>
#   CONTABO_KEY=<ssh-key>
#   VPS_USER=root
#   REMOTE_BACKEND_DIR=/opt/leaf-app
#   SKIP_LOCAL_TESTS=false
#   UPDATE_WORKERS=true
#   RUN_PUBLIC_SMOKE=true

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$BACKEND_DIR/.." && pwd)"

CONTABO_HOST="${CONTABO_HOST:-${VPS_HOST:-}}"
CONTABO_KEY="${CONTABO_KEY:-${VPS_KEY:-$HOME/.ssh/leaf_contabo_20260412_ed25519}}"
VPS_USER="${VPS_USER:-root}"
REMOTE_BACKEND_DIR="${REMOTE_BACKEND_DIR:-/opt/leaf-app}"
CONFIRM_PRODUCTION_DEPLOY="${CONFIRM_PRODUCTION_DEPLOY:-false}"
SKIP_LOCAL_TESTS="${SKIP_LOCAL_TESTS:-false}"
UPDATE_WORKERS="${UPDATE_WORKERS:-true}"
RUN_PUBLIC_SMOKE="${RUN_PUBLIC_SMOKE:-true}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-120}"

BASE_COMPOSE="docker-compose.production.yml"
SCALE_COMPOSE="docker-compose.gateway-scale.yml"
OPS_COMPOSE="docker-compose.ops-workers.yml"
REMOTE_BASE_COMPOSE="docker-compose.yml"
REMOTE_SCALE_COMPOSE="docker-compose.gateway-scale.yml"
REMOTE_OPS_COMPOSE="docker-compose.ops-workers.yml"

if [[ "$CONFIRM_PRODUCTION_DEPLOY" != "true" ]]; then
  echo "[deploy][error] Set CONFIRM_PRODUCTION_DEPLOY=true to authorize the production rollout." >&2
  exit 2
fi

if [[ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]]; then
  echo "[deploy][error] Production deploy bloqueado: worktree contém alterações não commitadas." >&2
  echo "[deploy][error] Crie a RC em um commit imutável e execute novamente." >&2
  exit 2
fi

if [[ -z "$CONTABO_HOST" ]]; then
  echo "[deploy][error] Configure CONTABO_HOST or VPS_HOST." >&2
  exit 2
fi

if [[ ! -f "$CONTABO_KEY" ]]; then
  echo "[deploy][error] SSH key not found: $CONTABO_KEY" >&2
  exit 2
fi

for required in "$BASE_COMPOSE" "$SCALE_COMPOSE" "$OPS_COMPOSE" Dockerfile package.json; do
  if [[ ! -f "$BACKEND_DIR/$required" ]]; then
    echo "[deploy][error] Missing local file: $BACKEND_DIR/$required" >&2
    exit 2
  fi
done

SSH_OPTS=(
  -i "$CONTABO_KEY"
  -o StrictHostKeyChecking=no
  -o UserKnownHostsFile=/dev/null
  -o ConnectTimeout=15
)
RSYNC_SSH="ssh -i \"$CONTABO_KEY\" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=15"

remote() {
  ssh "${SSH_OPTS[@]}" "$VPS_USER@$CONTABO_HOST" "$@"
}

echo "[deploy] Target: $VPS_USER@$CONTABO_HOST:$REMOTE_BACKEND_DIR"
echo "[deploy] Compose: $BASE_COMPOSE + $SCALE_COMPOSE"

if [[ "$SKIP_LOCAL_TESTS" != "true" ]]; then
  echo "[deploy] 1/7 Local validation"
  (
    cd "$BACKEND_DIR"
    bash -n scripts/deploy-contabo-docker.sh
    if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
      docker compose -f "$BASE_COMPOSE" -f "$SCALE_COMPOSE" -f "$OPS_COMPOSE" config --services >/dev/null
    else
      echo "[deploy][info] Docker unavailable locally; compose will be validated on the target host."
    fi
    npm run config:validate
    npm run check:no-active-vps-runtime
  )
else
  echo "[deploy] 1/7 Local validation skipped explicitly"
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
REMOTE_BACKUP_DIR="$REMOTE_BACKEND_DIR/backups/modular-rollout-$STAMP"

echo "[deploy] 2/7 Remote preflight and backup"
remote "
  set -e
  test -d '$REMOTE_BACKEND_DIR'
  test -f '$REMOTE_BACKEND_DIR/.env'
  command -v docker >/dev/null
  docker compose version >/dev/null
  mkdir -p '$REMOTE_BACKUP_DIR'
  cd '$REMOTE_BACKEND_DIR'
  docker compose -f '$REMOTE_BASE_COMPOSE' -f '$REMOTE_SCALE_COMPOSE' ps \
    > '$REMOTE_BACKUP_DIR/compose-ps-before.txt'
  docker image ls --digests > '$REMOTE_BACKUP_DIR/docker-images-before.txt'
  cp '$REMOTE_BASE_COMPOSE' '$REMOTE_BACKUP_DIR/$REMOTE_BASE_COMPOSE'
  cp '$REMOTE_SCALE_COMPOSE' '$REMOTE_BACKUP_DIR/$REMOTE_SCALE_COMPOSE'
  cp '$REMOTE_OPS_COMPOSE' '$REMOTE_BACKUP_DIR/$REMOTE_OPS_COMPOSE'
  tar \
    --exclude='./node_modules' \
    --exclude='./logs' \
    --exclude='./backups' \
    --exclude='./certbot' \
    --exclude='./ssl' \
    --exclude='./.git' \
    --exclude='./.env' \
    --exclude='./firebase-credentials.json' \
    -czf '$REMOTE_BACKUP_DIR/source-before.tar.gz' .
"
echo "[deploy] Backup: $REMOTE_BACKUP_DIR"

echo "[deploy] 3/7 Synchronizing application source"
rsync -az --delete-delay \
  --exclude ".git" \
  --exclude "node_modules" \
  --exclude "logs" \
  --exclude "backups" \
  --exclude "coverage" \
  --exclude ".nyc_output" \
  --exclude ".env" \
  --exclude ".env.*" \
  --exclude "firebase-credentials.json" \
  --exclude "ssl" \
  --exclude "certbot" \
  -e "$RSYNC_SSH" \
  "$BACKEND_DIR/" \
  "$VPS_USER@$CONTABO_HOST:$REMOTE_BACKEND_DIR/"

remote "
  set -e
  cd '$REMOTE_BACKEND_DIR'
  if [ '$BASE_COMPOSE' != '$REMOTE_BASE_COMPOSE' ]; then
    cp '$BASE_COMPOSE' '$REMOTE_BASE_COMPOSE'
  fi
  if [ '$SCALE_COMPOSE' != '$REMOTE_SCALE_COMPOSE' ]; then
    cp '$SCALE_COMPOSE' '$REMOTE_SCALE_COMPOSE'
  fi
  if [ '$OPS_COMPOSE' != '$REMOTE_OPS_COMPOSE' ]; then
    cp '$OPS_COMPOSE' '$REMOTE_OPS_COMPOSE'
  fi
  docker compose --env-file .env -f '$REMOTE_BASE_COMPOSE' -f '$REMOTE_SCALE_COMPOSE' -f '$REMOTE_OPS_COMPOSE' config --services \
    > '$REMOTE_BACKUP_DIR/compose-services-after-sync.txt'
"

echo "[deploy] 4/7 Building modular services"
remote "
  set -e
  cd '$REMOTE_BACKEND_DIR'
  docker compose -f '$REMOTE_BASE_COMPOSE' -f '$REMOTE_SCALE_COMPOSE' -f '$REMOTE_OPS_COMPOSE' build \
    websocket websocket-gateway-2 websocket-gateway-3 \
    sideeffects-worker billing-worker queue-worker \
    pricing-baseline-worker ride-health-monitor-worker
"

echo "[deploy] 5/7 Rolling gateways"
remote "
  set -e
  cd '$REMOTE_BACKEND_DIR'
  compose='docker compose -f $REMOTE_BASE_COMPOSE -f $REMOTE_SCALE_COMPOSE -f $REMOTE_OPS_COMPOSE'

  wait_healthy() {
    service=\"\$1\"
    container=\"\$2\"
    elapsed=0
    while [ \"\$elapsed\" -lt '$HEALTH_TIMEOUT_SECONDS' ]; do
      state=\$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \"\$container\" 2>/dev/null || true)
      if [ \"\$state\" = healthy ] || [ \"\$state\" = running ]; then
        echo \"[deploy][healthy] \$service (\$container)\"
        return 0
      fi
      if [ \"\$state\" = unhealthy ] || [ \"\$state\" = exited ] || [ \"\$state\" = dead ]; then
        echo \"[deploy][error] \$service state=\$state\" >&2
        docker logs --tail=120 \"\$container\" >&2 || true
        return 1
      fi
      sleep 3
      elapsed=\$((elapsed + 3))
    done
    echo \"[deploy][error] Timeout waiting for \$service\" >&2
    docker logs --tail=120 \"\$container\" >&2 || true
    return 1
  }

  \$compose up -d --no-deps websocket-gateway-2
  wait_healthy websocket-gateway-2 leaf-websocket-gateway-2

  \$compose up -d --no-deps websocket-gateway-3
  wait_healthy websocket-gateway-3 leaf-websocket-gateway-3

  \$compose up -d --no-deps websocket
  wait_healthy websocket leaf-websocket

  docker exec leaf-nginx nginx -t
  docker exec leaf-nginx nginx -s reload
"

if [[ "$UPDATE_WORKERS" == "true" ]]; then
  echo "[deploy] 6/7 Updating workers"
  remote "
    set -e
    cd '$REMOTE_BACKEND_DIR'
    compose='docker compose -f $REMOTE_BASE_COMPOSE -f $REMOTE_SCALE_COMPOSE -f $REMOTE_OPS_COMPOSE'
    wait_worker() {
      container=\"\$1\"
      elapsed=0
      while [ \"\$elapsed\" -lt '$HEALTH_TIMEOUT_SECONDS' ]; do
        state=\$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \"\$container\" 2>/dev/null || true)
        if [ \"\$state\" = healthy ] || [ \"\$state\" = running ]; then
          echo \"[deploy][healthy] \$container\"
          return 0
        fi
        if [ \"\$state\" = unhealthy ] || [ \"\$state\" = exited ] || [ \"\$state\" = dead ]; then
          docker logs --tail=120 \"\$container\" >&2 || true
          return 1
        fi
        sleep 3
        elapsed=\$((elapsed + 3))
      done
      echo \"[deploy][error] Timeout waiting for \$container\" >&2
      return 1
    }

    for pair in \
      'queue-worker:leaf-queue-worker' \
      'sideeffects-worker:leaf-sideeffects-worker' \
      'billing-worker:leaf-billing-worker' \
      'pricing-baseline-worker:leaf-pricing-baseline-worker' \
      'ride-health-monitor-worker:leaf-ride-health-monitor-worker'; do
      service=\${pair%%:*}
      container=\${pair#*:}
      \$compose up -d --no-deps \"\$service\"
      wait_worker \"\$container\"
    done
  "
else
  echo "[deploy] 6/7 Worker update skipped explicitly"
fi

echo "[deploy] 7/7 Health and public smoke"
remote "
  set -e
  cd '$REMOTE_BACKEND_DIR'
  docker compose -f '$REMOTE_BASE_COMPOSE' -f '$REMOTE_SCALE_COMPOSE' -f '$REMOTE_OPS_COMPOSE' ps
  curl -fsS --max-time 15 http://127.0.0.1:3001/health/liveness >/dev/null
  docker exec leaf-nginx nginx -t
"

if [[ "$RUN_PUBLIC_SMOKE" == "true" ]]; then
  curl -fsS --max-time 20 https://api.leaf.app.br/health >/dev/null
  curl -fsS --max-time 20 https://socket.leaf.app.br/health/liveness >/dev/null
fi

echo "[deploy][done] Modular rollout completed without compose teardown."
echo "[deploy][rollback] Restore $REMOTE_BACKUP_DIR/source-before.tar.gz and compose files, then roll gateways one at a time."
