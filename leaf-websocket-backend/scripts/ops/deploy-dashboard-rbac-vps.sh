#!/usr/bin/env bash
set -euo pipefail

# Deploy unificado:
# - Backend (RBAC + CORS + scripts admin profile)
# - Dashboard Next.js (layout + RBAC visual)
#
# Uso:
#   bash leaf-websocket-backend/scripts/ops/deploy-dashboard-rbac-vps.sh
# Opcional:
#   VPS_IP=<host-contabo> VPS_USER=root SSH_KEY_PATH=/path/key \
#   REMOTE_BACKEND_DIR=/opt/leaf-app REMOTE_DASHBOARD_DIR=/opt/leaf/leaf-dashboard-js \
#   bash leaf-websocket-backend/scripts/ops/deploy-dashboard-rbac-vps.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
BACKEND_LOCAL_DIR="$ROOT_DIR/leaf-websocket-backend"
DASH_LOCAL_DIR="$ROOT_DIR/leaf-dashboard-js"
MOBILE_LOCAL_DIR="$ROOT_DIR/mobile-app"

VPS_IP="${VPS_IP:-${CONTABO_HOST:-}}"
VPS_USER="${VPS_USER:-root}"
SSH_KEY_PATH="${SSH_KEY_PATH:-${CONTABO_KEY:-}}"
REMOTE_BACKEND_DIR="${REMOTE_BACKEND_DIR:-}"
REMOTE_DASHBOARD_DIR="${REMOTE_DASHBOARD_DIR:-}"
DASHBOARD_PORT="${DASHBOARD_PORT:-3020}"

if [[ -z "$VPS_IP" ]]; then
  echo "[deploy] configure VPS_IP ou CONTABO_HOST para o host Contabo" >&2
  exit 1
fi

if [[ -z "$SSH_KEY_PATH" || ! -f "$SSH_KEY_PATH" ]]; then
  echo "[deploy] configure SSH_KEY_PATH ou CONTABO_KEY com uma chave SSH válida" >&2
  exit 1
fi

SSH_OPTS=(
  -i "$SSH_KEY_PATH"
  -o StrictHostKeyChecking=no
  -o UserKnownHostsFile=/dev/null
  -o ConnectTimeout=12
)
RSYNC_SSH="ssh -i \"$SSH_KEY_PATH\" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=12"

resolve_google_maps_key() {
  local candidate=""

  if [[ -n "${NEXT_PUBLIC_GOOGLE_MAPS_API_KEY:-}" ]]; then
    candidate="${NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}"
  elif [[ -n "${GOOGLE_MAPS_API_KEY:-}" ]]; then
    candidate="${GOOGLE_MAPS_API_KEY}"
  fi

  if [[ -z "$candidate" ]]; then
    for env_file in \
      "$DASH_LOCAL_DIR/.env.local" \
      "$BACKEND_LOCAL_DIR/.env.production" \
      "$BACKEND_LOCAL_DIR/.env" \
      "$MOBILE_LOCAL_DIR/.env.production" \
      "$MOBILE_LOCAL_DIR/.env"; do
      if [[ -f "$env_file" ]]; then
        candidate="$(node -e "const fs=require('fs'); const text=fs.readFileSync(process.argv[1],'utf8'); const match=text.match(/^(?:NEXT_PUBLIC_GOOGLE_MAPS_API_KEY|GOOGLE_MAPS_API_KEY)=(.*)$/m); process.stdout.write(match ? String(match[1]).trim() : '')" "$env_file")"
        if [[ -n "$candidate" ]]; then
          break
        fi
      fi
    done
  fi

  printf '%s' "$candidate"
}

ssh_cmd() {
  ssh "${SSH_OPTS[@]}" "$VPS_USER@$VPS_IP" "$@"
}

scp_cmd() {
  scp "${SSH_OPTS[@]}" "$@"
}

echo "[deploy] Validando sintaxe local..."
node --check "$BACKEND_LOCAL_DIR/bootstrap/register-socket-create-booking-handler.js"
node --check "$BACKEND_LOCAL_DIR/commands/RequestRideCommand.js"
node --check "$BACKEND_LOCAL_DIR/routes/dashboard.js"
node --check "$BACKEND_LOCAL_DIR/routes/app-routes.js"
node --check "$BACKEND_LOCAL_DIR/routes/pricing.js"
node --check "$BACKEND_LOCAL_DIR/services/fare-estimation-service.js"
node --check "$BACKEND_LOCAL_DIR/services/create-booking-availability-precheck.js"
node --check "$BACKEND_LOCAL_DIR/services/gradual-radius-expander.js"
node --check "$BACKEND_LOCAL_DIR/services/h3-map-service.js"
node --check "$BACKEND_LOCAL_DIR/services/h3-visual-policy-service.js"
node --check "$BACKEND_LOCAL_DIR/services/pricing-context-store.js"
node --check "$BACKEND_LOCAL_DIR/services/pricing-context-provider.js"
node --check "$BACKEND_LOCAL_DIR/services/pricing-baseline-materializer.js"
node --check "$BACKEND_LOCAL_DIR/services/dashboard-websocket.js"
node --check "$BACKEND_LOCAL_DIR/services/ride-health-monitor.js"
node --check "$BACKEND_LOCAL_DIR/services/ride-queue-manager.js"
node --check "$BACKEND_LOCAL_DIR/services/ride-state-manager.js"
node --check "$BACKEND_LOCAL_DIR/services/pricing/utils.js"
node --check "$BACKEND_LOCAL_DIR/services/pricing/pressureScore.js"
node --check "$BACKEND_LOCAL_DIR/services/pricing/exceptionScore.js"
node --check "$BACKEND_LOCAL_DIR/services/pricing/operationalState.js"
node --check "$BACKEND_LOCAL_DIR/services/pricing/dynamicRules.js"
node --check "$BACKEND_LOCAL_DIR/services/pricing/calculateFare.js"
node --check "$BACKEND_LOCAL_DIR/services/pricing/index.js"
node --check "$BACKEND_LOCAL_DIR/middleware/support-auth.js"
node --check "$BACKEND_LOCAL_DIR/routes/notifications.js"
node --check "$BACKEND_LOCAL_DIR/routes/geofence-routes.js"
node --check "$BACKEND_LOCAL_DIR/routes/referral-programs.js"
node --check "$BACKEND_LOCAL_DIR/routes/waitlist.js"
node --check "$BACKEND_LOCAL_DIR/firebase-config.js"
node --check "$BACKEND_LOCAL_DIR/services/city-activation-state-service.js"
node --check "$BACKEND_LOCAL_DIR/utils/prometheus-metrics.js"
node --check "$BACKEND_LOCAL_DIR/server.js"
node --check "$BACKEND_LOCAL_DIR/server.vps.js"
node --check "$BACKEND_LOCAL_DIR/workers/pricing-baseline-worker.js"
node --check "$BACKEND_LOCAL_DIR/workers/ride-health-monitor-worker.js"
node --check "$BACKEND_LOCAL_DIR/scripts/ops/materialize-pricing-baselines.cjs"
node --check "$BACKEND_LOCAL_DIR/scripts/ops/backfill-ride-health-index.cjs"
node --check "$BACKEND_LOCAL_DIR/scripts/create-admin-profile-user.js"
if command -v docker >/dev/null 2>&1; then
  docker compose -f "$BACKEND_LOCAL_DIR/docker-compose.hostinger.yml" -f "$BACKEND_LOCAL_DIR/docker-compose.ops-workers.yml" config --services >/dev/null
fi
npm --prefix "$DASH_LOCAL_DIR" run -s lint
npm --prefix "$DASH_LOCAL_DIR" run -s build

if [[ -z "$REMOTE_BACKEND_DIR" ]]; then
  REMOTE_BACKEND_DIR="$(ssh_cmd '
    for d in /opt/leaf/leaf-websocket-backend /opt/leaf-app /opt/leaf; do
      if [ -f "$d/server.vps.js" ] || [ -f "$d/server.js" ]; then
        echo "$d"
        exit 0
      fi
    done
    exit 1
  ' || true)"
fi

if [[ -z "$REMOTE_BACKEND_DIR" ]]; then
  echo "[deploy] não foi possível detectar diretório backend remoto" >&2
  exit 1
fi

if [[ -z "$REMOTE_DASHBOARD_DIR" ]]; then
  REMOTE_DASHBOARD_DIR="$(ssh_cmd '
    for d in /opt/leaf/leaf-dashboard-js /opt/leaf-dashboard-js /opt/leaf-dashboard /opt/leaf/leaf-dashboard /opt/leaf-app/leaf-dashboard-js; do
      if [ -f "$d/package.json" ] && grep -q "\"next\"" "$d/package.json"; then
        echo "$d"
        exit 0
      fi
    done
    echo "/opt/leaf/leaf-dashboard-js"
  ')"
fi

echo "[deploy] backend remoto:   $REMOTE_BACKEND_DIR"
echo "[deploy] dashboard remoto: $REMOTE_DASHBOARD_DIR"

GOOGLE_MAPS_PUBLIC_KEY="$(resolve_google_maps_key)"
if [[ -n "$GOOGLE_MAPS_PUBLIC_KEY" ]]; then
  echo "[deploy] Google Maps key do dashboard: encontrada"
else
  echo "[deploy] Google Maps key do dashboard: ausente"
fi

ssh_cmd "mkdir -p '$REMOTE_BACKEND_DIR/bootstrap' '$REMOTE_BACKEND_DIR/commands' '$REMOTE_BACKEND_DIR/routes' '$REMOTE_BACKEND_DIR/services' '$REMOTE_BACKEND_DIR/services/pricing' '$REMOTE_BACKEND_DIR/utils' '$REMOTE_BACKEND_DIR/middleware' '$REMOTE_BACKEND_DIR/scripts' '$REMOTE_BACKEND_DIR/scripts/ops' '$REMOTE_BACKEND_DIR/workers' '$REMOTE_BACKEND_DIR/logs' '$REMOTE_DASHBOARD_DIR/app/observability' '$REMOTE_DASHBOARD_DIR/src/components'"

echo "[deploy] Enviando backend..."
scp_cmd "$BACKEND_LOCAL_DIR/bootstrap/register-socket-create-booking-handler.js" "$VPS_USER@$VPS_IP:$REMOTE_BACKEND_DIR/bootstrap/register-socket-create-booking-handler.js"
scp_cmd "$BACKEND_LOCAL_DIR/commands/RequestRideCommand.js" "$VPS_USER@$VPS_IP:$REMOTE_BACKEND_DIR/commands/RequestRideCommand.js"
scp_cmd "$BACKEND_LOCAL_DIR/routes/dashboard.js" "$VPS_USER@$VPS_IP:$REMOTE_BACKEND_DIR/routes/dashboard.js"
scp_cmd "$BACKEND_LOCAL_DIR/routes/app-routes.js" "$VPS_USER@$VPS_IP:$REMOTE_BACKEND_DIR/routes/app-routes.js"
scp_cmd "$BACKEND_LOCAL_DIR/routes/pricing.js" "$VPS_USER@$VPS_IP:$REMOTE_BACKEND_DIR/routes/pricing.js"
scp_cmd "$BACKEND_LOCAL_DIR/services/dashboard-websocket.js" "$VPS_USER@$VPS_IP:$REMOTE_BACKEND_DIR/services/dashboard-websocket.js"
scp_cmd "$BACKEND_LOCAL_DIR/services/fare-estimation-service.js" "$VPS_USER@$VPS_IP:$REMOTE_BACKEND_DIR/services/fare-estimation-service.js"
scp_cmd "$BACKEND_LOCAL_DIR/services/create-booking-availability-precheck.js" "$VPS_USER@$VPS_IP:$REMOTE_BACKEND_DIR/services/create-booking-availability-precheck.js"
scp_cmd "$BACKEND_LOCAL_DIR/services/gradual-radius-expander.js" "$VPS_USER@$VPS_IP:$REMOTE_BACKEND_DIR/services/gradual-radius-expander.js"
scp_cmd "$BACKEND_LOCAL_DIR/services/h3-map-service.js" "$VPS_USER@$VPS_IP:$REMOTE_BACKEND_DIR/services/h3-map-service.js"
scp_cmd "$BACKEND_LOCAL_DIR/services/h3-visual-policy-service.js" "$VPS_USER@$VPS_IP:$REMOTE_BACKEND_DIR/services/h3-visual-policy-service.js"
scp_cmd "$BACKEND_LOCAL_DIR/services/pricing-context-store.js" "$VPS_USER@$VPS_IP:$REMOTE_BACKEND_DIR/services/pricing-context-store.js"
scp_cmd "$BACKEND_LOCAL_DIR/services/pricing-context-provider.js" "$VPS_USER@$VPS_IP:$REMOTE_BACKEND_DIR/services/pricing-context-provider.js"
scp_cmd "$BACKEND_LOCAL_DIR/services/pricing-baseline-materializer.js" "$VPS_USER@$VPS_IP:$REMOTE_BACKEND_DIR/services/pricing-baseline-materializer.js"
scp_cmd "$BACKEND_LOCAL_DIR/services/ride-health-monitor.js" "$VPS_USER@$VPS_IP:$REMOTE_BACKEND_DIR/services/ride-health-monitor.js"
scp_cmd "$BACKEND_LOCAL_DIR/services/ride-queue-manager.js" "$VPS_USER@$VPS_IP:$REMOTE_BACKEND_DIR/services/ride-queue-manager.js"
scp_cmd "$BACKEND_LOCAL_DIR/services/ride-state-manager.js" "$VPS_USER@$VPS_IP:$REMOTE_BACKEND_DIR/services/ride-state-manager.js"
scp_cmd "$BACKEND_LOCAL_DIR/services/pricing/utils.js" "$VPS_USER@$VPS_IP:$REMOTE_BACKEND_DIR/services/pricing/utils.js"
scp_cmd "$BACKEND_LOCAL_DIR/services/pricing/pressureScore.js" "$VPS_USER@$VPS_IP:$REMOTE_BACKEND_DIR/services/pricing/pressureScore.js"
scp_cmd "$BACKEND_LOCAL_DIR/services/pricing/exceptionScore.js" "$VPS_USER@$VPS_IP:$REMOTE_BACKEND_DIR/services/pricing/exceptionScore.js"
scp_cmd "$BACKEND_LOCAL_DIR/services/pricing/operationalState.js" "$VPS_USER@$VPS_IP:$REMOTE_BACKEND_DIR/services/pricing/operationalState.js"
scp_cmd "$BACKEND_LOCAL_DIR/services/pricing/dynamicRules.js" "$VPS_USER@$VPS_IP:$REMOTE_BACKEND_DIR/services/pricing/dynamicRules.js"
scp_cmd "$BACKEND_LOCAL_DIR/services/pricing/calculateFare.js" "$VPS_USER@$VPS_IP:$REMOTE_BACKEND_DIR/services/pricing/calculateFare.js"
scp_cmd "$BACKEND_LOCAL_DIR/services/pricing/index.js" "$VPS_USER@$VPS_IP:$REMOTE_BACKEND_DIR/services/pricing/index.js"
scp_cmd "$BACKEND_LOCAL_DIR/middleware/support-auth.js" "$VPS_USER@$VPS_IP:$REMOTE_BACKEND_DIR/middleware/support-auth.js"
scp_cmd "$BACKEND_LOCAL_DIR/routes/notifications.js" "$VPS_USER@$VPS_IP:$REMOTE_BACKEND_DIR/routes/notifications.js"
scp_cmd "$BACKEND_LOCAL_DIR/routes/geofence-routes.js" "$VPS_USER@$VPS_IP:$REMOTE_BACKEND_DIR/routes/geofence-routes.js"
scp_cmd "$BACKEND_LOCAL_DIR/routes/referral-programs.js" "$VPS_USER@$VPS_IP:$REMOTE_BACKEND_DIR/routes/referral-programs.js"
scp_cmd "$BACKEND_LOCAL_DIR/routes/waitlist.js" "$VPS_USER@$VPS_IP:$REMOTE_BACKEND_DIR/routes/waitlist.js"
scp_cmd "$BACKEND_LOCAL_DIR/firebase-config.js" "$VPS_USER@$VPS_IP:$REMOTE_BACKEND_DIR/firebase-config.js"
scp_cmd "$BACKEND_LOCAL_DIR/services/city-activation-state-service.js" "$VPS_USER@$VPS_IP:$REMOTE_BACKEND_DIR/services/city-activation-state-service.js"
scp_cmd "$BACKEND_LOCAL_DIR/utils/prometheus-metrics.js" "$VPS_USER@$VPS_IP:$REMOTE_BACKEND_DIR/utils/prometheus-metrics.js"
scp_cmd "$BACKEND_LOCAL_DIR/server.js" "$VPS_USER@$VPS_IP:$REMOTE_BACKEND_DIR/server.js"
scp_cmd "$BACKEND_LOCAL_DIR/server.vps.js" "$VPS_USER@$VPS_IP:$REMOTE_BACKEND_DIR/server.vps.js"
scp_cmd "$BACKEND_LOCAL_DIR/workers/pricing-baseline-worker.js" "$VPS_USER@$VPS_IP:$REMOTE_BACKEND_DIR/workers/pricing-baseline-worker.js"
scp_cmd "$BACKEND_LOCAL_DIR/workers/pm2.pricing-baseline.config.js" "$VPS_USER@$VPS_IP:$REMOTE_BACKEND_DIR/workers/pm2.pricing-baseline.config.js"
scp_cmd "$BACKEND_LOCAL_DIR/workers/ride-health-monitor-worker.js" "$VPS_USER@$VPS_IP:$REMOTE_BACKEND_DIR/workers/ride-health-monitor-worker.js"
scp_cmd "$BACKEND_LOCAL_DIR/workers/pm2.ride-health-monitor.config.js" "$VPS_USER@$VPS_IP:$REMOTE_BACKEND_DIR/workers/pm2.ride-health-monitor.config.js"
scp_cmd "$BACKEND_LOCAL_DIR/scripts/ops/materialize-pricing-baselines.cjs" "$VPS_USER@$VPS_IP:$REMOTE_BACKEND_DIR/scripts/ops/materialize-pricing-baselines.cjs"
scp_cmd "$BACKEND_LOCAL_DIR/scripts/ops/backfill-ride-health-index.cjs" "$VPS_USER@$VPS_IP:$REMOTE_BACKEND_DIR/scripts/ops/backfill-ride-health-index.cjs"
scp_cmd "$BACKEND_LOCAL_DIR/scripts/ops/report-legacy-runtime-surface.cjs" "$VPS_USER@$VPS_IP:$REMOTE_BACKEND_DIR/scripts/ops/report-legacy-runtime-surface.cjs"
scp_cmd "$BACKEND_LOCAL_DIR/scripts/create-admin-profile-user.js" "$VPS_USER@$VPS_IP:$REMOTE_BACKEND_DIR/scripts/create-admin-profile-user.js"
scp_cmd "$BACKEND_LOCAL_DIR/docker-compose.ops-workers.yml" "$VPS_USER@$VPS_IP:$REMOTE_BACKEND_DIR/docker-compose.ops-workers.yml"
scp_cmd "$BACKEND_LOCAL_DIR/package.json" "$VPS_USER@$VPS_IP:$REMOTE_BACKEND_DIR/package.json"

echo "[deploy] Sincronizando dashboard completo..."
rsync -az --delete \
  --exclude ".git" \
  --exclude ".next" \
  --exclude "node_modules" \
  --exclude ".env.local" \
  --exclude ".env.production" \
  --exclude ".env.production.local" \
  -e "$RSYNC_SSH" \
  "$DASH_LOCAL_DIR/" \
  "$VPS_USER@$VPS_IP:$REMOTE_DASHBOARD_DIR/"

echo "[deploy] Aplicando env de produção do dashboard..."
ssh_cmd "cat > '$REMOTE_DASHBOARD_DIR/.env.production.local' <<'ENV_EOF'
NEXT_PUBLIC_API_URL=https://api.leaf.app.br
NEXT_PUBLIC_WS_URL=https://socket.leaf.app.br
NEXT_PUBLIC_API_DOCS_URL=https://api.leaf.app.br/api/docs
ENV_EOF"

if [[ -n "$GOOGLE_MAPS_PUBLIC_KEY" ]]; then
  ssh_cmd "printf '\nNEXT_PUBLIC_GOOGLE_MAPS_API_KEY=%s\n' '$GOOGLE_MAPS_PUBLIC_KEY' >> '$REMOTE_DASHBOARD_DIR/.env.production.local'"
fi

echo "[deploy] Instalando/reiniciando backend..."
ssh_cmd "
  set -e
  cd '$REMOTE_BACKEND_DIR'
  if command -v docker >/dev/null 2>&1 && [ -f docker-compose.yml ]; then
    if [ -f docker-compose.ops-workers.yml ]; then
      docker compose -f docker-compose.yml -f docker-compose.ops-workers.yml up -d --build websocket pricing-baseline-worker ride-health-monitor-worker
    else
      docker compose up -d --build websocket
    fi
  elif command -v pm2 >/dev/null 2>&1; then
    npm install --omit=dev >/dev/null 2>&1 || npm install >/dev/null 2>&1
    restarted=0
    for name in leaf-websocket-backend leaf-websocket leaf-backend leaf-api; do
      if pm2 describe \"\$name\" >/dev/null 2>&1; then
        pm2 restart \"\$name\" --update-env
        restarted=1
        break
      fi
    done
    if [ \"\$restarted\" -eq 0 ]; then
      echo '[deploy] Aviso: processo backend não encontrado no PM2; nenhum start automático executado.'
    fi

    if [ -f workers/ride-health-monitor-worker.js ] && [ -f workers/pm2.ride-health-monitor.config.js ]; then
      ENABLE_RIDE_HEALTH_MONITOR_WORKER=true \
      RIDE_HEALTH_MONITOR_BACKFILL_ON_BOOT=true \
      node workers/ride-health-monitor-worker.js --once --backfill >/tmp/ride-health-monitor-backfill.json 2>/tmp/ride-health-monitor-backfill.err || true

      if pm2 describe ride-health-monitor-worker >/dev/null 2>&1; then
        pm2 restart ride-health-monitor-worker --update-env
      else
        pm2 start workers/pm2.ride-health-monitor.config.js
      fi
    fi

    pm2 save >/dev/null 2>&1 || true
  elif command -v systemctl >/dev/null 2>&1; then
    systemctl restart leaf-websocket-backend 2>/dev/null || true
    systemctl restart leaf-api 2>/dev/null || true
  fi
"

echo "[deploy] Instalando/buildando/reiniciando dashboard..."
ssh_cmd "
  set -e
  cd '$REMOTE_DASHBOARD_DIR'
  npm install
  npm run build

  if command -v pm2 >/dev/null 2>&1; then
    pm2 delete leaf-dashboard-js 2>/dev/null || true
    pm2 start npm --name leaf-dashboard-js -- run start -- --port $DASHBOARD_PORT --hostname 0.0.0.0
    pm2 save >/dev/null 2>&1 || true
  elif command -v systemctl >/dev/null 2>&1; then
    systemctl restart leaf-dashboard 2>/dev/null || true
  else
    nohup npm start -- --port $DASHBOARD_PORT --hostname 0.0.0.0 >/tmp/leaf-dashboard.log 2>&1 &
  fi
"

echo "[deploy] Smoke checks..."
ssh_cmd "
  set -e
  for i in \$(seq 1 40); do
    if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -qx leaf-websocket; then
      if docker exec leaf-websocket curl -fsS -m 4 http://127.0.0.1:3001/health/liveness >/dev/null 2>&1; then
        exit 0
      fi
    elif curl -fsS -m 4 http://127.0.0.1:3001/health/liveness >/dev/null; then
      exit 0
    fi
    sleep 2
  done
  exit 1
"
ssh_cmd "
  set -e
  if command -v docker >/dev/null 2>&1 && [ -f '$REMOTE_BACKEND_DIR/docker-compose.yml' ] && [ -f '$REMOTE_BACKEND_DIR/docker-compose.ops-workers.yml' ]; then
    cd '$REMOTE_BACKEND_DIR'
    for svc in pricing-baseline-worker ride-health-monitor-worker; do
      ok=0
      for i in \$(seq 1 30); do
        if docker compose -f docker-compose.yml -f docker-compose.ops-workers.yml ps --status running --services \"\$svc\" | grep -qx \"\$svc\"; then
          ok=1
          break
        fi
        sleep 2
      done
      if [ \"\$ok\" -ne 1 ]; then
        echo \"[deploy] worker docker nao ficou running: \$svc\" >&2
        docker compose -f docker-compose.yml -f docker-compose.ops-workers.yml ps >&2 || true
        exit 1
      fi
    done
  fi
"
ssh_cmd "
  set -e
  for i in \$(seq 1 40); do
    if curl -fsS -m 4 http://127.0.0.1:$DASHBOARD_PORT/login >/dev/null; then
      exit 0
    fi
    sleep 2
  done
  exit 1
"

echo "[deploy] OK"
echo "[deploy] Backend:   https://api.leaf.app.br/api/health"
echo "[deploy] Dashboard: https://dashboard.leaf.app.br/login"
