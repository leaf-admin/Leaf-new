#!/usr/bin/env bash
set -euo pipefail

# Sobe um runtime canary na Contabo em porta local, valida readiness/socket e desliga.
# Nao substitui producao e nao expoe porta publica.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PROJECT_ROOT="$(cd "$BACKEND_DIR/.." && pwd)"

CONTABO_HOST="${CONTABO_HOST:-${VPS_HOST:-}}"
CONTABO_USER="${CONTABO_USER:-root}"
CONTABO_KEY="${CONTABO_KEY:-$HOME/.ssh/leaf_contabo_20260412_ed25519}"
REMOTE_APP_DIR="${REMOTE_APP_DIR:-/opt/leaf-app}"
REMOTE_CANARY_DIR="${REMOTE_CANARY_DIR:-/opt/leaf-runtime-canary}"
CANARY_PORT="${CANARY_PORT:-3901}"
RUN_FULL_FLOW_CANARY="${RUN_FULL_FLOW_CANARY:-false}"

if [[ -z "$CONTABO_HOST" ]]; then
  echo "[canary][error] Configure CONTABO_HOST ou VPS_HOST para o host Contabo" >&2
  exit 2
fi

if [[ ! -f "$CONTABO_KEY" ]]; then
  echo "[canary][error] Chave Contabo nao encontrada: $CONTABO_KEY" >&2
  exit 2
fi

SSH_OPTS=(
  -i "$CONTABO_KEY"
  -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=no
  -o UserKnownHostsFile=/dev/null
)

PACKAGE_PATH="/tmp/leaf-backend-canary-$(date +%Y%m%d%H%M%S).tar.gz"

echo "[canary] Empacotando backend sem secrets..."
COPYFILE_DISABLE=1 tar \
  --no-xattrs \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='logs' \
  --exclude='coverage' \
  --exclude='.tmp' \
  --exclude='test-results' \
  --exclude='firebase-credentials.json' \
  --exclude='leaf-reactnative-firebase-adminsdk-fbsvc-456a95e2fc.json' \
  --exclude='.env' \
  --exclude='.env.*' \
  -czf "$PACKAGE_PATH" \
  -C "$PROJECT_ROOT" \
  leaf-websocket-backend

echo "[canary] Enviando pacote para Contabo..."
scp "${SSH_OPTS[@]}" "$PACKAGE_PATH" "$CONTABO_USER@$CONTABO_HOST:/tmp/leaf-backend-canary.tar.gz" >/dev/null

echo "[canary] Preparando canary remoto em $REMOTE_CANARY_DIR..."
ssh "${SSH_OPTS[@]}" "$CONTABO_USER@$CONTABO_HOST" \
  "REMOTE_APP_DIR='$REMOTE_APP_DIR' REMOTE_CANARY_DIR='$REMOTE_CANARY_DIR' CANARY_PORT='$CANARY_PORT' RUN_FULL_FLOW_CANARY='$RUN_FULL_FLOW_CANARY' bash -s" <<'REMOTE_EOF'
set -euo pipefail

rm -rf "$REMOTE_CANARY_DIR"
mkdir -p "$REMOTE_CANARY_DIR"
tar -xzf /tmp/leaf-backend-canary.tar.gz -C "$REMOTE_CANARY_DIR" --strip-components=1
mkdir -p "$REMOTE_CANARY_DIR/logs"
chmod 0777 "$REMOTE_CANARY_DIR/logs"

cp "$REMOTE_APP_DIR/.env" "$REMOTE_CANARY_DIR/.env"
cp "$REMOTE_APP_DIR/firebase-credentials.json" "$REMOTE_CANARY_DIR/firebase-credentials.json"
if [[ -f "$REMOTE_APP_DIR/leaf-reactnative-firebase-adminsdk-fbsvc-456a95e2fc.json" ]]; then
  cp "$REMOTE_APP_DIR/leaf-reactnative-firebase-adminsdk-fbsvc-456a95e2fc.json" "$REMOTE_CANARY_DIR/leaf-reactnative-firebase-adminsdk-fbsvc-456a95e2fc.json"
fi

cat > "$REMOTE_CANARY_DIR/docker-compose.canary.yml" <<EOF
services:
  runtime-canary:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: leaf-runtime-canary
    command: ["bash", "scripts/runtime/start-server.sh"]
    env_file:
      - .env
    environment:
      # Canary isolado valida a aplicação, não o perfil de configuração de produção.
      NODE_ENV: development
      APP_ENV: runtime-canary
      LEAF_ENV: runtime-canary
      # The isolated canary full-flow uses socket mock payment on purpose.
      # Public production deploys remain protected by runtime config validation.
      APP_REVIEW: "true"
      PORT: 3001
      HOST: 0.0.0.0
      RUNTIME_ROLE: gateway
      LEAF_CLUSTER_ENABLED: "false"
      ENABLE_SOCKETIO_REDIS_ADAPTER: "true"
      REQUIRE_SOCKETIO_REDIS_ADAPTER: "true"
      REDIS_HOST: redis
      REDIS_PORT: 6379
      REDIS_DB: 0
      REDIS_URL: redis://:\${REDIS_PASSWORD}@redis:6379/0
      SOCKET_ALLOW_POLLING: "false"
      ALLOW_MULTIPLE_SESSIONS: "true"
      AUTO_TEST_MODE: "true"
      QA_SOCKET_BYPASS_UIDS: "runtime-full-passenger-modular-contabo-canary,runtime-full-driver-modular-contabo-canary"
      REQUIRE_PAYMENT_BEFORE_BOOKING: "false"
      VERIFY_PAYMENT_BEFORE_BOOKING: "false"
      REQUIRE_PAYMENT_CHARGE_REF_BEFORE_BOOKING: "false"
      MOCK_PAYMENT_FOR_TESTS: "true"
      CONFIRM_PAYMENT_SKIP_AVAILABILITY_CHECK: "true"
      ENABLE_QUEUE_BACKPRESSURE: "false"
      ENFORCE_PAYMENT_FARE_LOCK: "false"
      ENABLE_RIDER_EARLY_END: "true"
      TRIP_INTEGRITY_ENABLED: "true"
      ENABLE_EMBEDDED_LISTENER_WORKERS: "false"
      RUNTIME_ENABLE_QUEUE_WORKER: "false"
      ENABLE_RUNTIME_DEMAND_NOTIFICATION_SERVICE: "false"
      ENABLE_RUNTIME_DASHBOARD_WEBSOCKET: "false"
      ENABLE_RUNTIME_CLEANUP_JOB: "false"
      SUBSCRIPTION_DAILY_BILLING_ENABLED: "false"
      DAILY_EARNINGS_REPORT_ENABLED: "false"
      ENABLE_DRIVER_ELIGIBILITY_FIREBASE: "false"
      VEHICLE_LOCK_RECOVERY_FIREBASE_LOOKUP_ENABLED: "false"
      ENABLE_TRIP_LOCATION_FIRESTORE_PERSISTENCE: "false"
      LOG_LEVEL: warn
      RUNTIME_FULL_FLOW_INCLUDE_RIDE_CATEGORY: "false"
    ports:
      - "127.0.0.1:${CANARY_PORT}:3001"
    volumes:
      - ./firebase-credentials.json:/app/firebase-credentials.json:ro
      - ./logs:/app/logs
    networks:
      - leaf-network
    restart: "no"

networks:
  leaf-network:
    external: true
    name: leaf-app_leaf-network
EOF

cd "$REMOTE_CANARY_DIR"
docker compose -f docker-compose.canary.yml config >/tmp/leaf-runtime-canary-compose.config
docker compose -f docker-compose.canary.yml up -d --build runtime-canary

cleanup() {
  cd "$REMOTE_CANARY_DIR" || exit 0
  docker compose -f docker-compose.canary.yml down --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$REMOTE_CANARY_DIR" /tmp/leaf-backend-canary.tar.gz
}
trap cleanup EXIT

for i in $(seq 1 60); do
  if curl -fsS --max-time 2 "http://127.0.0.1:${CANARY_PORT}/health/liveness" >/tmp/canary-liveness.json 2>/tmp/canary-liveness.err; then
    echo "[canary][ok] liveness"
    cat /tmp/canary-liveness.json
    echo
    break
  fi

  if ! docker ps --format "{{.Names}}" | grep -qx leaf-runtime-canary; then
    echo "[canary][error] container encerrou cedo" >&2
    docker logs --tail=160 leaf-runtime-canary >&2 || true
    exit 1
  fi

  sleep 2
  if [[ "$i" == "60" ]]; then
    echo "[canary][error] timeout liveness" >&2
    docker logs --tail=180 leaf-runtime-canary >&2 || true
    exit 1
  fi
done

docker exec -i leaf-runtime-canary node - <<'NODE'
(async () => {
  const res = await fetch('http://127.0.0.1:3001/health/quick');
  const body = await res.json();
  const adapter = body.checks && body.checks.socketRedisAdapter;
  if (!res.ok || body.status !== 'healthy' || !adapter || adapter.state !== 'ready' || adapter.enabled !== true || adapter.required !== true) {
    console.error(JSON.stringify({ statusCode: res.status, status: body.status, adapter }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ statusCode: res.status, status: body.status, adapter }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE

docker exec -i leaf-runtime-canary node - <<'NODE'
const WebSocket = require('ws');
const ws = new WebSocket('ws://127.0.0.1:3001/socket.io/?EIO=4&transport=websocket');
const timer = setTimeout(() => {
  console.error('RAW_SOCKET_TIMEOUT');
  ws.terminate();
  process.exit(1);
}, 7000);
let opened = false;
ws.on('message', (data) => {
  const packet = data.toString();
  if (packet.startsWith('0')) {
    opened = true;
    ws.send('40');
    return;
  }
  if (packet.startsWith('40')) {
    clearTimeout(timer);
    console.log(JSON.stringify({ socket: 'engine.io+socket.io-connected', opened, namespaceReady: true, packet: packet.slice(0, 80) }));
    ws.close();
    process.exit(0);
  }
});
ws.on('error', (error) => {
  clearTimeout(timer);
  console.error('RAW_SOCKET_ERROR', error.message);
  process.exit(1);
});
NODE

if [[ "${RUN_FULL_FLOW_CANARY}" == "true" ]]; then
  echo "[canary][full-flow] iniciando corrida completa contra o backend canônico"
  docker exec -i \
    -e RUNTIME_FULL_FLOW_TARGET_URL="http://127.0.0.1:3001" \
    -e RUNTIME_FULL_FLOW_TARGET_RUNTIME="modular-contabo-canary" \
    -e RUNTIME_FULL_FLOW_ARTIFACT_ROOT="/app/logs/runtime-full-ride-flow" \
    -e RUNTIME_FULL_FLOW_CLEANUP_REDIS="true" \
    -e RUNTIME_FULL_FLOW_TIMEOUT_MS="70000" \
    -e RUNTIME_FULL_FLOW_VERBOSE="true" \
    -e RUNTIME_FULL_FLOW_FORCE_RAW_WS="true" \
    -e RUNTIME_FULL_FLOW_QA_AUTH_BYPASS="true" \
    -e RUNTIME_FULL_FLOW_ID_SUFFIX="modular-contabo-canary" \
    leaf-runtime-canary \
    node scripts/tests/smoke-runtime-full-ride-flow.cjs | tee /tmp/leaf-runtime-canary-full-flow-output.json
fi

echo "[canary][prod]"
docker ps --filter name=leaf-websocket --format "{{.Names}} {{.Status}} {{.Ports}}"
REMOTE_EOF

echo "[canary] PASS - canary encerrado automaticamente"
