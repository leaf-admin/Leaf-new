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
#   PRODUCTION_RELEASE_SHA=<exact origin/main SHA>
#
# Optional:
#   CONTABO_HOST=<host>
#   CONTABO_KEY=<ssh-key>
#   CONTABO_KNOWN_HOSTS_FILE=~/.ssh/known_hosts
#   VPS_USER=root
#   REMOTE_BACKEND_DIR=/opt/leaf-app
#   SKIP_LOCAL_TESTS=false
#   VALIDATE_LOCAL_RUNTIME_CONFIG=true
#   DEPLOY_TRACKED_PATHS="relative/path.js another/path.js"
#   GATEWAY_ONLY_DEPLOY=false
#   UPDATE_COMPOSE_FILES=true
#   UPDATE_WORKERS=true
#   RUN_PUBLIC_SMOKE=true
#   AUTO_ROLLBACK=true

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$BACKEND_DIR/.." && pwd)"

CONTABO_HOST="${CONTABO_HOST:-${VPS_HOST:-}}"
CONTABO_KEY="${CONTABO_KEY:-${VPS_KEY:-$HOME/.ssh/leaf_contabo_20260412_ed25519}}"
CONTABO_KNOWN_HOSTS_FILE="${CONTABO_KNOWN_HOSTS_FILE:-$HOME/.ssh/known_hosts}"
VPS_USER="${VPS_USER:-root}"
REMOTE_BACKEND_DIR="${REMOTE_BACKEND_DIR:-/opt/leaf-app}"
CONFIRM_PRODUCTION_DEPLOY="${CONFIRM_PRODUCTION_DEPLOY:-false}"
PRODUCTION_RELEASE_SHA="${PRODUCTION_RELEASE_SHA:-}"
SKIP_LOCAL_TESTS="${SKIP_LOCAL_TESTS:-false}"
VALIDATE_LOCAL_RUNTIME_CONFIG="${VALIDATE_LOCAL_RUNTIME_CONFIG:-true}"
DEPLOY_TRACKED_PATHS="${DEPLOY_TRACKED_PATHS:-}"
GATEWAY_ONLY_DEPLOY="${GATEWAY_ONLY_DEPLOY:-false}"
UPDATE_COMPOSE_FILES="${UPDATE_COMPOSE_FILES:-true}"
UPDATE_WORKERS="${UPDATE_WORKERS:-true}"
RUN_PUBLIC_SMOKE="${RUN_PUBLIC_SMOKE:-true}"
AUTO_ROLLBACK="${AUTO_ROLLBACK:-true}"
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

for boolean_name in \
  SKIP_LOCAL_TESTS \
  VALIDATE_LOCAL_RUNTIME_CONFIG \
  GATEWAY_ONLY_DEPLOY \
  UPDATE_COMPOSE_FILES \
  UPDATE_WORKERS \
  RUN_PUBLIC_SMOKE \
  AUTO_ROLLBACK; do
  boolean_value="${!boolean_name}"
  if [[ "$boolean_value" != "true" && "$boolean_value" != "false" ]]; then
    echo "[deploy][error] $boolean_name must be true or false." >&2
    exit 2
  fi
done

if [[ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]]; then
  echo "[deploy][error] Production deploy bloqueado: worktree contém alterações não commitadas." >&2
  echo "[deploy][error] Crie a RC em um commit imutável e execute novamente." >&2
  exit 2
fi

CURRENT_BRANCH="$(git -C "$REPO_ROOT" branch --show-current)"
RELEASE_SHA="$(git -C "$REPO_ROOT" rev-parse HEAD)"
REMOTE_MAIN_SHA="$(git -C "$REPO_ROOT" rev-parse --verify refs/remotes/origin/main 2>/dev/null)" || {
  echo "[deploy][error] origin/main is unavailable; refresh the remote reference first." >&2
  exit 2
}

if [[ "$CURRENT_BRANCH" != "main" ]]; then
  echo "[deploy][error] Production deploy must run from main." >&2
  exit 2
fi
if [[ -z "$PRODUCTION_RELEASE_SHA" || "$PRODUCTION_RELEASE_SHA" != "$RELEASE_SHA" ]]; then
  echo "[deploy][error] PRODUCTION_RELEASE_SHA must exactly match HEAD ($RELEASE_SHA)." >&2
  exit 2
fi
if [[ "$RELEASE_SHA" != "$REMOTE_MAIN_SHA" ]]; then
  echo "[deploy][error] HEAD must exactly match origin/main before deployment." >&2
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

if [[ ! -f "$CONTABO_KNOWN_HOSTS_FILE" ]]; then
  echo "[deploy][error] SSH known_hosts not found: $CONTABO_KNOWN_HOSTS_FILE" >&2
  exit 2
fi

if ! ssh-keygen -F "$CONTABO_HOST" -f "$CONTABO_KNOWN_HOSTS_FILE" >/dev/null; then
  echo "[deploy][error] Production host is not pinned in $CONTABO_KNOWN_HOSTS_FILE." >&2
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
  -o StrictHostKeyChecking=yes
  -o "UserKnownHostsFile=$CONTABO_KNOWN_HOSTS_FILE"
  -o ConnectTimeout=15
)
RSYNC_SSH="ssh -i \"$CONTABO_KEY\" -o StrictHostKeyChecking=yes -o UserKnownHostsFile=\"$CONTABO_KNOWN_HOSTS_FILE\" -o ConnectTimeout=15"

TRACKED_MANIFEST="$(mktemp)"
RELEASE_STAGING_DIR=""
SYNC_SOURCE_DIR="$BACKEND_DIR/"
# Keep this array non-empty for the Bash 3.2 shipped by macOS. Full releases and
# targeted releases append their mode-specific arguments below. The metadata
# guards prevent a local mktemp mode or workstation UID/GID from being applied
# to the production source tree.
RSYNC_TRANSFER_ARGS=(--no-owner --no-group --chmod=Du=rwx,Dgo=rx)
ROLLBACK_ARMED=false
STAMP=""
REMOTE_BACKUP_DIR=""

cleanup_local() {
  rm -f "$TRACKED_MANIFEST"
  if [[ -n "$RELEASE_STAGING_DIR" && -d "$RELEASE_STAGING_DIR" ]]; then
    rm -rf -- "$RELEASE_STAGING_DIR"
  fi
}

trap cleanup_local EXIT

remote() {
  ssh "${SSH_OPTS[@]}" "$VPS_USER@$CONTABO_HOST" "$@"
}

rollback_on_error() {
  original_status=$?
  trap - ERR

  if [[ "$ROLLBACK_ARMED" == "true" && "$AUTO_ROLLBACK" == "true" ]]; then
    echo "[deploy][rollback] Failure detected; restoring source, compose and container images." >&2
    set +e
    remote "
      set -e
      cd '$REMOTE_BACKEND_DIR'
      tar -xzf '$REMOTE_BACKUP_DIR/source-before.tar.gz' -C '$REMOTE_BACKEND_DIR'
      cp '$REMOTE_BACKUP_DIR/$REMOTE_BASE_COMPOSE' '$REMOTE_BASE_COMPOSE'
      cp '$REMOTE_BACKUP_DIR/$REMOTE_SCALE_COMPOSE' '$REMOTE_SCALE_COMPOSE'
      cp '$REMOTE_BACKUP_DIR/$REMOTE_OPS_COMPOSE' '$REMOTE_OPS_COMPOSE'

      while IFS='|' read -r container configured_image previous_image rollback_tag; do
        test -n \"\$container\"
        test -n \"\$configured_image\"
        test -n \"\$previous_image\"
        docker image inspect \"\$rollback_tag\" >/dev/null
        docker image tag \"\$previous_image\" \"\$configured_image\"
      done < '$REMOTE_BACKUP_DIR/container-images-before.txt'

      compose='docker compose -f $REMOTE_BASE_COMPOSE -f $REMOTE_SCALE_COMPOSE -f $REMOTE_OPS_COMPOSE'
      for service in websocket-gateway-2 websocket-gateway-3 websocket; do
        \$compose up -d --no-deps --no-build --force-recreate \"\$service\"
      done

      if [ '$GATEWAY_ONLY_DEPLOY' != true ]; then
        for service in \
          trip-location-worker \
          queue-worker \
          sideeffects-worker \
          billing-worker \
          pricing-baseline-worker \
          ride-health-monitor-worker; do
          \$compose up -d --no-deps --no-build --force-recreate \"\$service\"
        done
      fi

      elapsed=0
      until docker exec leaf-websocket \
        curl -fsS --max-time 10 http://127.0.0.1:3001/health/readiness >/dev/null 2>&1; do
        if [ \"\$elapsed\" -ge '$HEALTH_TIMEOUT_SECONDS' ]; then
          echo '[deploy][rollback][error] Readiness did not recover.' >&2
          exit 1
        fi
        sleep 3
        elapsed=\$((elapsed + 3))
      done
      docker exec leaf-nginx nginx -t
      docker exec leaf-nginx nginx -s reload
      cmp -s .env '$REMOTE_BACKUP_DIR/.env.before'
    "
    rollback_status=$?
    set -e

    if [[ "$rollback_status" -eq 0 ]]; then
      echo "[deploy][rollback] Automatic rollback completed." >&2
    else
      echo "[deploy][rollback][error] Automatic rollback failed; backup: $REMOTE_BACKUP_DIR" >&2
    fi
  fi

  exit "$original_status"
}

trap rollback_on_error ERR

if [[ -n "$DEPLOY_TRACKED_PATHS" ]]; then
  RSYNC_TRANSFER_ARGS+=(--from0 --files-from="$TRACKED_MANIFEST")
  for relative_path in $DEPLOY_TRACKED_PATHS; do
    if [[ "$relative_path" = /* || "$relative_path" == *".."* ]]; then
      echo "[deploy][error] Invalid targeted path: $relative_path" >&2
      exit 2
    fi
    git -C "$REPO_ROOT" ls-files --error-unmatch \
      "leaf-websocket-backend/$relative_path" >/dev/null
    printf '%s\0' "$relative_path" >> "$TRACKED_MANIFEST"
  done
else
  RELEASE_STAGING_DIR="$(mktemp -d)"
  git -C "$REPO_ROOT" archive --format=tar "$RELEASE_SHA:leaf-websocket-backend" |
    tar -xf - -C "$RELEASE_STAGING_DIR"
  test -f "$RELEASE_STAGING_DIR/package.json"
  SYNC_SOURCE_DIR="$RELEASE_STAGING_DIR/"
  RSYNC_TRANSFER_ARGS+=(--delete --delete-delay)
fi

if [[ -n "$DEPLOY_TRACKED_PATHS" && ! -s "$TRACKED_MANIFEST" ]]; then
  echo "[deploy][error] Tracked source manifest is empty." >&2
  exit 2
fi

if [[ "$GATEWAY_ONLY_DEPLOY" == "true" ]]; then
  UPDATE_WORKERS=false
fi

echo "[deploy] Target: $VPS_USER@$CONTABO_HOST:$REMOTE_BACKEND_DIR"
echo "[deploy] Compose: $BASE_COMPOSE + $SCALE_COMPOSE"
echo "[deploy] Release SHA: $RELEASE_SHA"

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
    if [[ "$VALIDATE_LOCAL_RUNTIME_CONFIG" == "true" ]]; then
      npm run config:validate
    else
      echo "[deploy][info] Local runtime config validation skipped; the active remote .env remains authoritative."
    fi
    npm run check:single-backend-runtime
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
  command -v rsync >/dev/null
  docker compose version >/dev/null
  mkdir -p '$REMOTE_BACKUP_DIR'
  chmod 700 '$REMOTE_BACKUP_DIR'
  cd '$REMOTE_BACKEND_DIR'
  cp .env '$REMOTE_BACKUP_DIR/.env.before'
  chmod 600 '$REMOTE_BACKUP_DIR/.env.before'
  docker compose -f '$REMOTE_BASE_COMPOSE' -f '$REMOTE_SCALE_COMPOSE' ps \
    > '$REMOTE_BACKUP_DIR/compose-ps-before.txt'
  docker image ls --digests > '$REMOTE_BACKUP_DIR/docker-images-before.txt'
  : > '$REMOTE_BACKUP_DIR/container-images-before.txt'
  for container in \
    leaf-websocket \
    leaf-websocket-gateway-2 \
    leaf-websocket-gateway-3 \
    leaf-trip-location-worker \
    leaf-queue-worker \
    leaf-sideeffects-worker \
    leaf-billing-worker \
    leaf-pricing-baseline-worker \
    leaf-ride-health-monitor-worker; do
    previous_image=\$(docker inspect --format '{{.Image}}' \"\$container\")
    configured_image=\$(docker inspect --format '{{.Config.Image}}' \"\$container\")
    test -n \"\$previous_image\"
    test -n \"\$configured_image\"
    rollback_tag=\"leaf-app-rollback:$STAMP-\${container#leaf-}\"
    docker image tag \"\$previous_image\" \"\$rollback_tag\"
    printf '%s|%s|%s|%s\n' \
      \"\$container\" \"\$configured_image\" \"\$previous_image\" \"\$rollback_tag\" \
      >> '$REMOTE_BACKUP_DIR/container-images-before.txt'
  done
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
    --exclude='.env*' \
    --exclude='*.env' \
    --exclude='*.env.*' \
    --exclude='*.pem' \
    --exclude='*.p12' \
    --exclude='*.pfx' \
    --exclude='*.jks' \
    --exclude='*.keystore' \
    --exclude='*.key' \
    --exclude='*.crt' \
    --exclude='*.cer' \
    --exclude='firebase-credentials.json' \
    --exclude='leaf-reactnative-firebase-adminsdk-*.json' \
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
ROLLBACK_ARMED=true
echo "[deploy] Backup: $REMOTE_BACKUP_DIR"

echo "[deploy] 3/7 Previewing tracked application source"
rsync -azc --dry-run --itemize-changes \
  "${RSYNC_TRANSFER_ARGS[@]}" \
  --exclude ".git" \
  --exclude "node_modules" \
  --exclude "logs" \
  --exclude "backups" \
  --exclude "coverage" \
  --exclude ".nyc_output" \
  --exclude ".env" \
  --exclude ".env.*" \
  --exclude "*.env" \
  --exclude "*.env.*" \
  --exclude "firebase-credentials.json" \
  --exclude "leaf-reactnative-firebase-adminsdk-*.json" \
  --exclude "*.pem" \
  --exclude "*.p12" \
  --exclude "*.pfx" \
  --exclude "*.jks" \
  --exclude "*.keystore" \
  --exclude "*.key" \
  --exclude "*.crt" \
  --exclude "*.cer" \
  --exclude "ssl" \
  --exclude "certbot" \
  --exclude "/docker-compose.yml" \
  -e "$RSYNC_SSH" \
  "$SYNC_SOURCE_DIR" \
  "$VPS_USER@$CONTABO_HOST:$REMOTE_BACKEND_DIR/"

echo "[deploy] 3/7 Synchronizing tracked application source"
rsync -azc --itemize-changes \
  "${RSYNC_TRANSFER_ARGS[@]}" \
  --exclude ".git" \
  --exclude "node_modules" \
  --exclude "logs" \
  --exclude "backups" \
  --exclude "coverage" \
  --exclude ".nyc_output" \
  --exclude ".env" \
  --exclude ".env.*" \
  --exclude "*.env" \
  --exclude "*.env.*" \
  --exclude "firebase-credentials.json" \
  --exclude "leaf-reactnative-firebase-adminsdk-*.json" \
  --exclude "*.pem" \
  --exclude "*.p12" \
  --exclude "*.pfx" \
  --exclude "*.jks" \
  --exclude "*.keystore" \
  --exclude "*.key" \
  --exclude "*.crt" \
  --exclude "*.cer" \
  --exclude "ssl" \
  --exclude "certbot" \
  --exclude "/docker-compose.yml" \
  -e "$RSYNC_SSH" \
  "$SYNC_SOURCE_DIR" \
  "$VPS_USER@$CONTABO_HOST:$REMOTE_BACKEND_DIR/"

remote "
  set -e
  cd '$REMOTE_BACKEND_DIR'
  if [ '$UPDATE_COMPOSE_FILES' = true ]; then
    if [ '$BASE_COMPOSE' != '$REMOTE_BASE_COMPOSE' ]; then
      cp '$BASE_COMPOSE' '$REMOTE_BASE_COMPOSE'
    fi
    if [ '$SCALE_COMPOSE' != '$REMOTE_SCALE_COMPOSE' ]; then
      cp '$SCALE_COMPOSE' '$REMOTE_SCALE_COMPOSE'
    fi
    if [ '$OPS_COMPOSE' != '$REMOTE_OPS_COMPOSE' ]; then
      cp '$OPS_COMPOSE' '$REMOTE_OPS_COMPOSE'
    fi
  fi
  cmp -s .env '$REMOTE_BACKUP_DIR/.env.before'
  validator_image=\$(docker inspect --format '{{.Image}}' leaf-websocket)
  test -n \"\$validator_image\"
  docker run --rm \
    --user 0:0 \
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
  if [ '$GATEWAY_ONLY_DEPLOY' = true ]; then
    GIT_SHA='$RELEASE_SHA' \$compose build websocket websocket-gateway-2 websocket-gateway-3
  else
    GIT_SHA='$RELEASE_SHA' \$compose build \
      websocket websocket-gateway-2 websocket-gateway-3 \
      sideeffects-worker billing-worker queue-worker \
      trip-location-worker pricing-baseline-worker ride-health-monitor-worker
  fi
  # docker compose images reports the image of the still-running container
  # during a rolling deploy. Inspect the deterministic build tag instead.
  candidate_image='leaf-app-websocket:latest'
  docker image inspect "\$candidate_image" >/dev/null
  test \"\$(docker image inspect --format '{{index .Config.Labels \"org.opencontainers.image.revision\"}}' \"\$candidate_image\")\" = '$RELEASE_SHA'
  docker image inspect --format '{{range .Config.Env}}{{println .}}{{end}}' \"\$candidate_image\" |
    grep -Fxq 'GIT_SHA=$RELEASE_SHA'
  docker run --rm \
    --user 0:0 \
    --env-file .env \
    -e ENV_FILE=/dev/null \
    -e NODE_ENV=production \
    --entrypoint node \
    "\$candidate_image" \
    scripts/deploy/validate-runtime-config.js
  test -f firebase-credentials.json
  docker run --rm \
    --user 0:0 \
    --env-file .env \
    -e ENV_FILE=/dev/null \
    -e NODE_ENV=production \
    -e GOOGLE_APPLICATION_CREDENTIALS=/app/firebase-credentials.json \
    -v "\$PWD/firebase-credentials.json:/app/firebase-credentials.json:ro" \
    --entrypoint node \
    "\$candidate_image" \
    scripts/ops/preflight-firebase-runtime-iam.cjs
  run_backup_preflight() {
    docker run --rm \
      --user 0:0 \
      --env-file .env \
      -e ENV_FILE=/dev/null \
      -e NODE_ENV=production \
      "\$@" \
      --entrypoint node \
      "\$candidate_image" \
      scripts/ops/preflight-backup-recovery.cjs
  }
  if [ -d /var/backups/leaf ]; then
    run_backup_preflight -v /var/backups/leaf:/var/backups/leaf:ro
  else
    run_backup_preflight
  fi
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

  verify_release() {
    container=\"\$1\"
    actual_sha=\$(docker inspect --format '{{index .Config.Labels \"org.opencontainers.image.revision\"}}' \"\$container\")
    test \"\$actual_sha\" = '$RELEASE_SHA'
    docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' \"\$container\" |
      grep -Fxq 'GIT_SHA=$RELEASE_SHA'
    echo \"[deploy][release] \$container sha=\$actual_sha\"
  }

  # Readiness dos gateways depende deste consumer. Suba-o primeiro para evitar
  # deadlock no primeiro rollout do runtime canônico.
  if [ '$GATEWAY_ONLY_DEPLOY' != true ]; then
    \$compose up -d --no-deps trip-location-worker
  fi
  wait_healthy trip-location-worker leaf-trip-location-worker

  \$compose up -d --no-deps websocket-gateway-2
  wait_healthy websocket-gateway-2 leaf-websocket-gateway-2
  wait_ready leaf-websocket-gateway-2
  verify_release leaf-websocket-gateway-2

  \$compose up -d --no-deps websocket-gateway-3
  wait_healthy websocket-gateway-3 leaf-websocket-gateway-3
  wait_ready leaf-websocket-gateway-3
  verify_release leaf-websocket-gateway-3

  \$compose up -d --no-deps websocket
  wait_healthy websocket leaf-websocket
  wait_ready leaf-websocket
  verify_release leaf-websocket

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
      actual_sha=\$(docker inspect --format '{{index .Config.Labels \"org.opencontainers.image.revision\"}}' \"\$container\")
      test \"\$actual_sha\" = '$RELEASE_SHA'
      docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' \"\$container\" |
        grep -Fxq 'GIT_SHA=$RELEASE_SHA'
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
  cmp -s .env '$REMOTE_BACKUP_DIR/.env.before'
"

if [[ "$RUN_PUBLIC_SMOKE" == "true" ]]; then
  curl -fsS --max-time 20 https://api.leaf.app.br/health >/dev/null
  curl -fsS --max-time 20 https://socket.leaf.app.br/health/liveness >/dev/null
  curl -fsS --max-time 20 https://socket.leaf.app.br/health/readiness >/dev/null
fi

ROLLBACK_ARMED=false
trap - ERR
echo "[deploy][done] Modular rollout completed without compose teardown."
echo "[deploy][rollback] Automatic rollback is disarmed after successful public smoke. Backup: $REMOTE_BACKUP_DIR"
