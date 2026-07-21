#!/usr/bin/env bash
set -euo pipefail

# Modular production rollout for the Contabo host.
#
# This script never tears down the compose project, Redis, or named volumes.
# It never converts or restarts Redis. The Redis authority must be activated
# separately through the reviewed runbook; this script validates it live before
# replacing gateways, waits for readiness, then updates workers.
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
  chmod 700 '$REMOTE_BACKUP_DIR'
  cd '$REMOTE_BACKEND_DIR'
  cp .env '$REMOTE_BACKUP_DIR/.env.before'
  chmod 600 '$REMOTE_BACKUP_DIR/.env.before'
  docker compose -f '$REMOTE_BASE_COMPOSE' -f '$REMOTE_SCALE_COMPOSE' ps \
    > '$REMOTE_BACKUP_DIR/compose-ps-before.txt'
  docker image ls --digests > '$REMOTE_BACKUP_DIR/docker-images-before.txt'
  previous_backend_image=\$(docker inspect --format '{{.Image}}' leaf-websocket)
  test -n "\$previous_backend_image"
  docker image tag "\$previous_backend_image" 'leaf-app-websocket:rollback-$STAMP'
  printf '%s\n' "\$previous_backend_image" > '$REMOTE_BACKUP_DIR/backend-image-before.txt'
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

  authority_mode=\$(awk -F= '\$1==\"KYC_ACTIVE_TRIP_AUTHORITY_MODE\" {print substr(\$0,index(\$0,\"=\")+1)}' .env | tail -n1 | tr -d '\r')
  case \"\$authority_mode\" in
    ''|redis_noeviction)
      ;;
    *)
      echo '[deploy][error] KYC_ACTIVE_TRIP_AUTHORITY_MODE must be empty or redis_noeviction.' >&2
      exit 1
      ;;
  esac
  if [ \"\$authority_mode\" = redis_noeviction ]; then
    expected_generation=\$(awk -F= '\$1==\"REDIS_CRITICAL_DATASET_GENERATION\" {print substr(\$0,index(\$0,\"=\")+1)}' .env | tail -n1 | tr -d '\r')
    generation_key=\$(awk -F= '\$1==\"REDIS_CRITICAL_DATASET_GENERATION_KEY\" {print substr(\$0,index(\$0,\"=\")+1)}' .env | tail -n1 | tr -d '\r')
    trip_stream_enabled=\$(awk -F= '\$1==\"ENABLE_TRIP_LOCATION_STREAM\" {print substr(\$0,index(\$0,\"=\")+1)}' .env | tail -n1 | tr -d '\r')
    trip_stream_name=\$(awk -F= '\$1==\"TRIP_LOCATION_STREAM_NAME\" {print substr(\$0,index(\$0,\"=\")+1)}' .env | tail -n1 | tr -d '\r')
    trip_group=\$(awk -F= '\$1==\"TRIP_LOCATION_WORKER_GROUP\" {print substr(\$0,index(\$0,\"=\")+1)}' .env | tail -n1 | tr -d '\r')
    trip_consumer_max_idle_ms=\$(awk -F= '\$1==\"TRIP_LOCATION_CONSUMER_MAX_IDLE_MS\" {print substr(\$0,index(\$0,\"=\")+1)}' .env | tail -n1 | tr -d '\r')
    trip_worker_health_key=\$(awk -F= '\$1==\"TRIP_LOCATION_WORKER_HEALTH_KEY\" {print substr(\$0,index(\$0,\"=\")+1)}' .env | tail -n1 | tr -d '\r')
    trip_worker_health_max_age_ms=\$(awk -F= '\$1==\"TRIP_LOCATION_WORKER_HEALTH_MAX_AGE_MS\" {print substr(\$0,index(\$0,\"=\")+1)}' .env | tail -n1 | tr -d '\r')
    generation_key=\${generation_key:-leaf:runtime:critical-dataset:generation}
    trip_stream_enabled=\${trip_stream_enabled:-true}
    trip_stream_name=\${trip_stream_name:-trip_location_events}
    trip_group=\${trip_group:-trip-location-workers}
    trip_consumer_max_idle_ms=\${trip_consumer_max_idle_ms:-30000}
    trip_worker_health_key=\${trip_worker_health_key:-leaf:runtime:trip-location-worker:health}
    trip_worker_health_max_age_ms=\${trip_worker_health_max_age_ms:-45000}
    test -n \"\$expected_generation\"
    test \"\$(sysctl -n vm.overcommit_memory)\" = 1

    redis_cmd() {
      docker exec leaf-redis sh -ec 'REDISCLI_AUTH=\"\$REDIS_PASSWORD\" exec redis-cli --no-auth-warning --raw \"\$@\"' sh \"\$@\"
    }

    test \"\$(redis_cmd CONFIG GET maxmemory-policy | tail -n1)\" = noeviction
    test \"\$(redis_cmd CONFIG GET appendonly | tail -n1)\" = yes
    test \"\$(redis_cmd CONFIG GET appendfsync | tail -n1)\" = everysec
    test \"\$(redis_cmd CONFIG GET maxmemory | tail -n1)\" = 2415919104
    redis_cmd INFO persistence | tr -d '\r' | grep -qx 'aof_enabled:1'
    redis_cmd INFO persistence | tr -d '\r' | grep -qx 'aof_last_write_status:ok'
    redis_cmd INFO stats | tr -d '\r' | grep -qx 'evicted_keys:0'
    test \"\$(redis_cmd GET \"\$generation_key\")\" = \"\$expected_generation\"
    test \"\$(redis_cmd TTL \"\$generation_key\")\" = -1
    trip_stream_enabled_normalized=\$(printf '%s' \"\$trip_stream_enabled\" | tr '[:upper:]' '[:lower:]')
    case \"\$trip_stream_enabled_normalized\" in
      1|true|yes|on|sim)
        case \"\$trip_consumer_max_idle_ms\" in
          ''|*[!0-9]*)
            echo '[deploy][error] TRIP_LOCATION_CONSUMER_MAX_IDLE_MS must be an integer.' >&2
            exit 1
            ;;
        esac
        if [ \"\$trip_consumer_max_idle_ms\" -lt 1000 ] || [ \"\$trip_consumer_max_idle_ms\" -gt 300000 ]; then
          echo '[deploy][error] TRIP_LOCATION_CONSUMER_MAX_IDLE_MS must be between 1000 and 300000ms.' >&2
          exit 1
        fi
        case \"\$trip_worker_health_max_age_ms\" in
          ''|*[!0-9]*)
            echo '[deploy][error] TRIP_LOCATION_WORKER_HEALTH_MAX_AGE_MS must be an integer.' >&2
            exit 1
            ;;
        esac
        if [ \"\$trip_worker_health_max_age_ms\" -lt 1000 ] || [ \"\$trip_worker_health_max_age_ms\" -gt 300000 ]; then
          echo '[deploy][error] TRIP_LOCATION_WORKER_HEALTH_MAX_AGE_MS must be between 1000 and 300000ms.' >&2
          exit 1
        fi
        redis_cmd XINFO GROUPS \"\$trip_stream_name\" | grep -Fxq \"\$trip_group\"
        trip_consumers=\$(redis_cmd XINFO CONSUMERS \"\$trip_stream_name\" \"\$trip_group\")
        printf '%s\n' \"\$trip_consumers\" | awk -v max_idle=\"\$trip_consumer_max_idle_ms\" '
          previous == \"idle\" && \$0 ~ /^[0-9]+\$/ && (\$0 + 0) <= max_idle { active = 1 }
          { previous = \$0 }
          END { exit(active ? 0 : 1) }
        '
        trip_worker_health_status=\$(redis_cmd HGET \"\$trip_worker_health_key\" status)
        case \"\$trip_worker_health_status\" in
          healthy|idle)
            ;;
          *)
            echo '[deploy][error] Trip-location persistence heartbeat is missing, invalid or degraded.' >&2
            exit 1
            ;;
        esac
        trip_worker_heartbeat_at=\$(redis_cmd HGET \"\$trip_worker_health_key\" heartbeatAt)
        case \"\$trip_worker_heartbeat_at\" in
          ''|*[!0-9]*)
            echo '[deploy][error] Trip-location persistence heartbeatAt is invalid.' >&2
            exit 1
            ;;
        esac
        trip_worker_health_ttl=\$(redis_cmd TTL \"\$trip_worker_health_key\")
        case \"\$trip_worker_health_ttl\" in
          ''|*[!0-9]*)
            echo '[deploy][error] Trip-location persistence heartbeat TTL is invalid.' >&2
            exit 1
            ;;
        esac
        if [ \"\$trip_worker_health_ttl\" -le 0 ]; then
          echo '[deploy][error] Trip-location persistence heartbeat TTL must be positive.' >&2
          exit 1
        fi
        trip_worker_heartbeat_age_ms=\$((\$(date +%s%3N) - trip_worker_heartbeat_at))
        if [ \"\$trip_worker_heartbeat_age_ms\" -lt 0 ] || [ \"\$trip_worker_heartbeat_age_ms\" -gt \"\$trip_worker_health_max_age_ms\" ]; then
          echo '[deploy][error] Trip-location persistence heartbeat is stale.' >&2
          exit 1
        fi
        echo '[deploy][preflight] Trip-location consumer and persistence heartbeat validated.'
        ;;
      0|false|no|off|nao|não)
        echo '[deploy][preflight] Trip-location stream disabled; consumer liveness gate skipped.'
        ;;
      *)
        echo '[deploy][error] ENABLE_TRIP_LOCATION_STREAM must be an explicit boolean.' >&2
        exit 1
        ;;
    esac
    echo '[deploy][preflight] Redis critical authority validated.'
  fi
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
  --exclude "leaf-reactnative-firebase-adminsdk-*.json" \
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
  validator_image=\$(docker inspect --format '{{.Image}}' leaf-websocket)
  test -n \"\$validator_image\"
  docker run --rm \
    --env-file .env \
    -e ENV_FILE=/dev/null \
    -e NODE_ENV=production \
    -e NODE_PATH=/app/node_modules \
    -v \"\$PWD:/workspace:ro\" \
    -w /workspace \
    --entrypoint node \
    \"\$validator_image\" \
    scripts/deploy/validate-runtime-config.js
  docker compose --env-file .env -f '$REMOTE_BASE_COMPOSE' -f '$REMOTE_SCALE_COMPOSE' -f '$REMOTE_OPS_COMPOSE' config --services \
    > '$REMOTE_BACKUP_DIR/compose-services-after-sync.txt'
"

echo "[deploy] 4/7 Building modular services"
remote "
  set -e
  cd '$REMOTE_BACKEND_DIR'
  compose='docker compose -f $REMOTE_BASE_COMPOSE -f $REMOTE_SCALE_COMPOSE -f $REMOTE_OPS_COMPOSE'
  \$compose build \
    websocket websocket-gateway-2 websocket-gateway-3 \
    sideeffects-worker billing-worker queue-worker \
    trip-location-worker pricing-baseline-worker ride-health-monitor-worker
  candidate_image=\$(\$compose images -q websocket | head -n1)
  test -n "\$candidate_image"
  docker run --rm \
    --env-file .env \
    -e ENV_FILE=/dev/null \
    -e NODE_ENV=production \
    --entrypoint node \
    "\$candidate_image" \
    scripts/deploy/validate-runtime-config.js
  printf '%s\n' "\$candidate_image" > '$REMOTE_BACKUP_DIR/backend-image-candidate.txt'
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

  wait_ready() {
    container=\"\$1\"
    elapsed=0
    while [ \"\$elapsed\" -lt '$HEALTH_TIMEOUT_SECONDS' ]; do
      if docker exec \"\$container\" curl -fsS --max-time 10 http://127.0.0.1:3001/health/readiness >/dev/null 2>&1; then
        echo \"[deploy][ready] \$container\"
        return 0
      fi
      sleep 3
      elapsed=\$((elapsed + 3))
    done
    echo \"[deploy][error] Readiness timeout for \$container\" >&2
    docker logs --tail=120 \"\$container\" >&2 || true
    return 1
  }

  # Readiness dos gateways depende deste consumer. Suba-o primeiro para evitar
  # deadlock no primeiro rollout do runtime canônico.
  \$compose up -d --no-deps trip-location-worker
  wait_healthy trip-location-worker leaf-trip-location-worker

  \$compose up -d --no-deps websocket-gateway-2
  wait_healthy websocket-gateway-2 leaf-websocket-gateway-2
  wait_ready leaf-websocket-gateway-2

  \$compose up -d --no-deps websocket-gateway-3
  wait_healthy websocket-gateway-3 leaf-websocket-gateway-3
  wait_ready leaf-websocket-gateway-3

  \$compose up -d --no-deps websocket
  wait_healthy websocket leaf-websocket
  wait_ready leaf-websocket

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
  curl -fsS --max-time 15 http://127.0.0.1:3001/health/readiness >/dev/null
  docker exec leaf-nginx nginx -t
"

if [[ "$RUN_PUBLIC_SMOKE" == "true" ]]; then
  curl -fsS --max-time 20 https://api.leaf.app.br/health >/dev/null
  curl -fsS --max-time 20 https://socket.leaf.app.br/health/liveness >/dev/null
  curl -fsS --max-time 20 https://socket.leaf.app.br/health/readiness >/dev/null
fi

echo "[deploy][done] Modular rollout completed without compose teardown."
echo "[deploy][rollback] Restore $REMOTE_BACKUP_DIR/source-before.tar.gz and compose files, then roll gateways one at a time."
