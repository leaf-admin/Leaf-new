#!/usr/bin/env bash
set -euo pipefail

# Rollout backend: thresholds de health do piloto para VPS pequena.
# Uso:
#   bash leaf-websocket-backend/scripts/ops/rollout-health-thresholds-vps.sh
#
# Variáveis opcionais:
#   VPS_HOST=<host-contabo>
#   VPS_USER=root
#   VPS_KEY=/caminho/para/contabokey
#   REMOTE_BACKEND_DIR=/opt/leaf-app
#   APPLY_ENV=true|false   (default: true)
#   REBUILD_WEBSOCKET=true|false (default: true)
#   RUN_SMOKE=true|false   (default: true)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
BACKEND_DIR="$PROJECT_ROOT/leaf-websocket-backend"

VPS_HOST="${VPS_HOST:-${CONTABO_HOST:-}}"
VPS_USER="${VPS_USER:-root}"
VPS_KEY="${VPS_KEY:-${CONTABO_KEY:-$HOME/.ssh/leaf_contabo_20260412_ed25519}}"
REMOTE_BACKEND_DIR="${REMOTE_BACKEND_DIR:-}"

APPLY_ENV="${APPLY_ENV:-true}"
REBUILD_WEBSOCKET="${REBUILD_WEBSOCKET:-true}"
RUN_SMOKE="${RUN_SMOKE:-true}"

FILES_TO_DEPLOY=(
  "services/health-check-service.js"
)

if [[ ! -d "$BACKEND_DIR" ]]; then
  echo "[rollout][error] Backend dir não encontrado: $BACKEND_DIR"
  exit 2
fi

if [[ -z "$VPS_HOST" ]]; then
  echo "[rollout][error] Configure VPS_HOST ou CONTABO_HOST para o host Contabo"
  exit 2
fi

if [[ -z "$VPS_KEY" || ! -f "$VPS_KEY" ]]; then
  echo "[rollout][error] Configure VPS_KEY ou CONTABO_KEY com uma chave SSH válida"
  exit 2
fi

for relative in "${FILES_TO_DEPLOY[@]}"; do
  if [[ ! -f "$BACKEND_DIR/$relative" ]]; then
    echo "[rollout][error] Arquivo local ausente: $BACKEND_DIR/$relative"
    exit 2
  fi
done

SSH_OPTS=(
  -i "$VPS_KEY"
  -o StrictHostKeyChecking=no
  -o UserKnownHostsFile=/dev/null
)

run_ssh() {
  ssh "${SSH_OPTS[@]}" "$VPS_USER@$VPS_HOST" "$@"
}

scp_cmd() {
  scp "${SSH_OPTS[@]}" "$@"
}

if [[ -z "$REMOTE_BACKEND_DIR" ]]; then
  REMOTE_BACKEND_DIR="$(
    run_ssh '
      for d in /opt/leaf-app /opt/leaf/leaf-websocket-backend /opt/leaf; do
        if [ -f "$d/server.js" ]; then
          echo "$d"
          exit 0
        fi
      done
      exit 1
    ' || true
  )"
fi

if [[ -z "$REMOTE_BACKEND_DIR" ]]; then
  echo "[rollout][error] Não foi possível detectar diretório remoto do backend."
  echo "[rollout][hint] Informe REMOTE_BACKEND_DIR manualmente."
  exit 2
fi

echo "[rollout] VPS..............: $VPS_USER@$VPS_HOST"
echo "[rollout] Backend remoto...: $REMOTE_BACKEND_DIR"
echo "[rollout] Chave SSH........: $VPS_KEY"
echo

echo "[rollout] 1/6 Validando código local..."
node --check "$BACKEND_DIR/services/health-check-service.js"
(
  cd "$BACKEND_DIR"
  npx jest tests/unit/services/health-check-service.unit.test.js --runInBand
)
echo "[rollout][ok] Código local validado."
echo

echo "[rollout] 2/6 Criando backup remoto..."
BACKUP_STAMP="$(date +%Y%m%d-%H%M%S)"
REMOTE_BACKUP_DIR="$REMOTE_BACKEND_DIR/backups/health-threshold-rollout-$BACKUP_STAMP"
run_ssh "mkdir -p '$REMOTE_BACKUP_DIR/services'"
run_ssh "if [ -f '$REMOTE_BACKEND_DIR/services/health-check-service.js' ]; then cp '$REMOTE_BACKEND_DIR/services/health-check-service.js' '$REMOTE_BACKUP_DIR/services/health-check-service.js'; fi"
run_ssh "if [ -f '$REMOTE_BACKEND_DIR/.env' ]; then cp '$REMOTE_BACKEND_DIR/.env' '$REMOTE_BACKUP_DIR/.env'; fi"
echo "[rollout][ok] Backup remoto em: $REMOTE_BACKEND_DIR/backups/health-threshold-rollout-$BACKUP_STAMP"
echo

echo "[rollout] 3/6 Enviando arquivo de serviço..."
run_ssh "mkdir -p '$REMOTE_BACKEND_DIR/services'"
scp_cmd "$BACKEND_DIR/services/health-check-service.js" "$VPS_USER@$VPS_HOST:$REMOTE_BACKEND_DIR/services/health-check-service.js" >/dev/null
echo "[rollout][sent] services/health-check-service.js"
echo "[rollout][ok] Arquivo enviado."
echo

if [[ "$APPLY_ENV" == "true" ]]; then
  echo "[rollout] 4/6 Aplicando thresholds de health no env remoto..."
  run_ssh "
    set -e
    cd '$REMOTE_BACKEND_DIR'
    ENV_FILE=''
    for f in .env config.env .env.production; do
      if [ -f \"\$f\" ]; then ENV_FILE=\"\$f\"; break; fi
    done
    if [ -z \"\$ENV_FILE\" ]; then
      ENV_FILE='.env'
      touch \"\$ENV_FILE\"
    fi

    upsert() {
      key=\"\$1\"
      value=\"\$2\"
      if grep -q \"^\${key}=\" \"\$ENV_FILE\"; then
        sed -i \"s|^\${key}=.*|\${key}=\${value}|\" \"\$ENV_FILE\"
      else
        echo \"\${key}=\${value}\" >> \"\$ENV_FILE\"
      fi
    }

    upsert LEAF_LAUNCH_PROFILE pilot_controlled
    upsert ENABLE_DRIVER_WITHDRAWALS false
    upsert ENABLE_REFERRAL_PROGRAMS false
    upsert ENABLE_DEMAND_PREDICTION false
    upsert ENABLE_SOFT_BAN_ENFORCEMENT false
    upsert ENABLE_ADMIN_MUTATIONS false
    upsert HEALTH_SYSTEM_MEMORY_WARNING_PERCENT 80
    upsert HEALTH_SYSTEM_MEMORY_CRITICAL_PERCENT 92
    upsert HEALTH_SYSTEM_CPU_WARNING_PERCENT 120
    upsert HEALTH_SYSTEM_CPU_CRITICAL_PERCENT 200
    upsert HEALTH_SYSTEM_CPU_SUSTAINED_CRITICAL_PERCENT 140

    echo \"[rollout][env] arquivo: \$ENV_FILE\"
    grep -E '^(LEAF_LAUNCH_PROFILE|ENABLE_DRIVER_WITHDRAWALS|ENABLE_REFERRAL_PROGRAMS|ENABLE_DEMAND_PREDICTION|ENABLE_SOFT_BAN_ENFORCEMENT|ENABLE_ADMIN_MUTATIONS|HEALTH_SYSTEM_)=' \"\$ENV_FILE\"
  "
  echo "[rollout][ok] Env remoto atualizado."
  echo
else
  echo "[rollout] 4/6 APPLY_ENV=false, pulando atualização de env."
  echo
fi

if [[ "$REBUILD_WEBSOCKET" == "true" ]]; then
  echo "[rollout] 5/6 Rebuildando websocket..."
  run_ssh "
    set -e
    cd '$REMOTE_BACKEND_DIR'
    if command -v docker >/dev/null 2>&1 && [ -f docker-compose.yml ]; then
      if docker compose version >/dev/null 2>&1; then
        docker compose up -d --build websocket
        docker compose ps websocket
      else
        docker-compose up -d --build websocket
        docker-compose ps websocket
      fi
    else
      echo '[rollout][error] docker compose indisponível neste host' >&2
      exit 1
    fi
  "
  echo "[rollout][ok] Websocket rebuildado."
  echo
else
  echo "[rollout] 5/6 REBUILD_WEBSOCKET=false, pulando rebuild."
  echo
fi

if [[ "$RUN_SMOKE" == "true" ]]; then
  echo "[rollout] 6/6 Smoke pós-deploy..."
  run_ssh "
    set -e
    cd '$REMOTE_BACKEND_DIR'
    sleep 8
    health=\$(curl -sS --max-time 12 http://localhost:3001/health || true)
    if [ -z \"\$health\" ]; then
      echo '[rollout][smoke][error] /health sem resposta em localhost:3001'
      exit 1
    fi
    echo \"[rollout][smoke][health] \$health\" | head -c 600
    echo
  "
  echo "[rollout][ok] Smoke concluído."
  echo
else
  echo "[rollout] 6/6 RUN_SMOKE=false, pulando smoke."
  echo
fi

echo "[rollout][done] Rollout finalizado com sucesso."
echo "[rollout][info] Backup remoto: $REMOTE_BACKEND_DIR/backups/health-threshold-rollout-$BACKUP_STAMP"
