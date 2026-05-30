#!/usr/bin/env bash
set -euo pipefail

# Rollout backend: assinatura diária acumulada + liquidação no saque.
# Uso:
#   bash leaf-websocket-backend/scripts/ops/rollout-daily-subscription-withdraw-vps.sh
#
# Variáveis opcionais:
#   VPS_HOST=<host-contabo>
#   VPS_USER=root
#   VPS_KEY=/caminho/para/contabokey
#   REMOTE_BACKEND_DIR=/opt/leaf
#   APPLY_ENV=true|false   (default: true)
#   RESTART_APP=true|false (default: true)
#   RUN_SMOKE=true|false   (default: true)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
BACKEND_DIR="$PROJECT_ROOT/leaf-websocket-backend"

VPS_HOST="${VPS_HOST:-${CONTABO_HOST:-}}"
VPS_USER="${VPS_USER:-root}"
VPS_KEY="${VPS_KEY:-${CONTABO_KEY:-$HOME/.ssh/leaf_contabo_20260412_ed25519}}"
REMOTE_BACKEND_DIR="${REMOTE_BACKEND_DIR:-}"

APPLY_ENV="${APPLY_ENV:-true}"
RESTART_APP="${RESTART_APP:-true}"
RUN_SMOKE="${RUN_SMOKE:-true}"

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

FILES_TO_DEPLOY=(
  "services/daily-subscription-service.js"
  "services/payment-service.js"
  "routes/payment.js"
  "routes/dashboard.js"
  "server.js"
  "scripts/tests/test-subscription-grace-policy-mock.js"
)

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

if [[ -z "$REMOTE_BACKEND_DIR" ]]; then
  REMOTE_BACKEND_DIR="$(
    run_ssh '
      for d in /opt/leaf/leaf-websocket-backend /opt/leaf-app /opt/leaf; do
        if [ -f "$d/server.vps.js" ] || [ -f "$d/server.js" ]; then
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

echo "[rollout] 1/6 Validando sintaxe local..."
node --check "$BACKEND_DIR/services/daily-subscription-service.js"
node --check "$BACKEND_DIR/services/payment-service.js"
node --check "$BACKEND_DIR/routes/payment.js"
node --check "$BACKEND_DIR/routes/dashboard.js"
node --check "$BACKEND_DIR/server.js"
echo "[rollout][ok] Sintaxe local validada."
echo

echo "[rollout] 2/6 Criando backup remoto..."
BACKUP_STAMP="$(date +%Y%m%d-%H%M%S)"
REMOTE_BACKUP_DIR="$REMOTE_BACKEND_DIR/backups/subscription-withdraw-rollout-$BACKUP_STAMP"
run_ssh "mkdir -p '$REMOTE_BACKUP_DIR'"
for relative in "${FILES_TO_DEPLOY[@]}"; do
  run_ssh "if [ -f '$REMOTE_BACKEND_DIR/$relative' ]; then mkdir -p '$REMOTE_BACKUP_DIR/$(dirname "$relative")' && cp '$REMOTE_BACKEND_DIR/$relative' '$REMOTE_BACKUP_DIR/$relative'; fi"
done
echo "[rollout][ok] Backup remoto em: $REMOTE_BACKUP_DIR"
echo

echo "[rollout] 3/6 Enviando arquivos..."
for relative in "${FILES_TO_DEPLOY[@]}"; do
  run_ssh "mkdir -p '$REMOTE_BACKEND_DIR/$(dirname "$relative")'"
  scp "${SSH_OPTS[@]}" "$BACKEND_DIR/$relative" "$VPS_USER@$VPS_HOST:$REMOTE_BACKEND_DIR/$relative" >/dev/null
  echo "[rollout][sent] $relative"
done
echo "[rollout][ok] Arquivos enviados."
echo

if [[ "$APPLY_ENV" == "true" ]]; then
  echo "[rollout] 4/6 Aplicando variáveis de ambiente..."
  run_ssh "
    set -e
    cd '$REMOTE_BACKEND_DIR'
    ENV_FILE=''
    for f in config.env .env .env.production; do
      if [ -f \"\$f\" ]; then ENV_FILE=\"\$f\"; break; fi
    done
    if [ -z \"\$ENV_FILE\" ]; then
      ENV_FILE='config.env'
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

    upsert SUBSCRIPTION_SETTLE_ON_WITHDRAW true
    upsert SUBSCRIPTION_SPLIT_RETENTION_ENABLED false
    upsert SUBSCRIPTION_DAILY_BILLING_ENABLED false
    upsert SUBSCRIPTION_BLOCK_ON_GRACE_EXPIRY false
    upsert SUBSCRIPTION_BILLING_CONFIG_PATH subscription_billing/config
    upsert SUBSCRIPTION_PLUS_WAVE_1_DAILY_CENTS 990
    upsert SUBSCRIPTION_PLUS_WAVE_2_DAILY_CENTS 990
    upsert SUBSCRIPTION_PLUS_WAVE_3_DAILY_CENTS 990
    upsert SUBSCRIPTION_PLUS_DAILY_CENTS 990
    upsert SUBSCRIPTION_ELITE_DAILY_CENTS 0

    echo \"[rollout][env] arquivo: \$ENV_FILE\"
    grep -E '^(SUBSCRIPTION_SETTLE_ON_WITHDRAW|SUBSCRIPTION_SPLIT_RETENTION_ENABLED|SUBSCRIPTION_DAILY_BILLING_ENABLED|SUBSCRIPTION_BLOCK_ON_GRACE_EXPIRY|SUBSCRIPTION_BILLING_CONFIG_PATH|SUBSCRIPTION_PLUS_WAVE_1_DAILY_CENTS|SUBSCRIPTION_PLUS_WAVE_2_DAILY_CENTS|SUBSCRIPTION_PLUS_WAVE_3_DAILY_CENTS|SUBSCRIPTION_PLUS_DAILY_CENTS|SUBSCRIPTION_ELITE_DAILY_CENTS)=' \"\$ENV_FILE\"
  "
  echo "[rollout][ok] Variáveis aplicadas."
  echo
else
  echo "[rollout] 4/6 APPLY_ENV=false, pulando atualização de env."
  echo
fi

if [[ "$RESTART_APP" == "true" ]]; then
  echo "[rollout] 5/6 Reiniciando aplicação..."
  run_ssh "
    set -e
    cd '$REMOTE_BACKEND_DIR'
    if command -v pm2 >/dev/null 2>&1; then
      pm2 restart leaf-websocket-backend --update-env 2>/dev/null || \
      pm2 restart leaf-websocket --update-env 2>/dev/null || \
      pm2 restart leaf-backend --update-env 2>/dev/null || \
      pm2 restart leaf-api --update-env 2>/dev/null || \
      pm2 restart all --update-env
      pm2 save || true
      echo '[rollout][restart] pm2'
    elif command -v systemctl >/dev/null 2>&1; then
      systemctl restart leaf-primary 2>/dev/null || \
      systemctl restart leaf-backend 2>/dev/null || \
      systemctl restart leaf-websocket 2>/dev/null || \
      true
      echo '[rollout][restart] systemctl'
    else
      pkill -f 'node.*server' || true
      nohup node server.js > server.log 2>&1 &
      echo '[rollout][restart] nohup'
    fi
  "
  echo "[rollout][ok] Reinício concluído."
  echo
else
  echo "[rollout] 5/6 RESTART_APP=false, pulando reinício."
  echo
fi

if [[ "$RUN_SMOKE" == "true" ]]; then
  echo "[rollout] 6/6 Smoke pós-deploy..."
  run_ssh "
    set -e
    cd '$REMOTE_BACKEND_DIR'
    health=\$(curl -sS --max-time 8 http://localhost:3001/health || curl -sS --max-time 8 http://localhost/health || true)
    if [ -z \"\$health\" ]; then
      echo '[rollout][smoke][error] Health endpoint sem resposta'
      exit 1
    fi
    echo \"[rollout][smoke][health] \$health\" | head -c 240
    echo

    balance=\$(curl -sS --max-time 10 http://localhost:3001/api/payment/driver-balance/smoke_driver || true)
    if ! echo \"\$balance\" | grep -q 'subscriptionPendingFeeCents'; then
      echo '[rollout][smoke][error] Endpoint balance sem campo subscriptionPendingFeeCents'
      exit 1
    fi
    echo \"[rollout][smoke][balance] OK\"

    subs=\$(curl -sS --max-time 12 'http://localhost:3001/api/subscriptions/drivers?limit=1' || true)
    if ! echo \"\$subs\" | grep -q 'subscriptions'; then
      echo '[rollout][smoke][error] Endpoint subscriptions/drivers inválido'
      exit 1
    fi
    echo \"[rollout][smoke][subscriptions] OK\"
  "
  echo "[rollout][ok] Smoke concluído."
  echo
else
  echo "[rollout] 6/6 RUN_SMOKE=false, pulando smoke."
  echo
fi

echo "[rollout][done] Rollout finalizado com sucesso."
echo "[rollout][info] Backup remoto: $REMOTE_BACKEND_DIR/backups/subscription-withdraw-rollout-$BACKUP_STAMP"
