#!/bin/bash
#
# Script para enviar as configs atualizadas do Nginx e recarregar o serviço
# Uso:
#   SSH_HOST=user@ip ./scripts/deploy-nginx-waitlist-fix.sh
# Variáveis úteis:
#   SSH_HOST            -> host no formato user@ip (OBRIGATÓRIO)
#   SSH_KEY             -> caminho para chave ssh (opcional)
#   REMOTE_LEAF_CONF    -> destino do arquivo principal (default /etc/nginx/sites-available/leaf-app-br)
#   REMOTE_WAITLIST_CONF-> destino do arquivo waitlist (default /etc/nginx/sites-available/leaf-waitlist-secure)
#   REMOTE_SITES_ENABLED-> pasta dos links simbólicos (default /etc/nginx/sites-enabled)

set -euo pipefail

if [[ -z "${SSH_HOST:-}" ]]; then
  echo "❌ Defina a variável SSH_HOST (ex: SSH_HOST=leaf@216.x.x.x $0)"
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LEAF_CONF="$REPO_ROOT/config/nginx/nginx-leaf-app-br.conf"
WAITLIST_CONF="$REPO_ROOT/config/nginx/nginx-waitlist-secure.conf"

if [[ ! -f "$LEAF_CONF" || ! -f "$WAITLIST_CONF" ]]; then
  echo "❌ Arquivos de configuração não encontrados em $REPO_ROOT/config/nginx"
  exit 1
fi

SSH_OPTS=""
if [[ -n "${SSH_KEY:-}" ]]; then
  SSH_OPTS="-i ${SSH_KEY}"
fi

REMOTE_LEAF_CONF="${REMOTE_LEAF_CONF:-/etc/nginx/sites-available/leaf-app-br}"
REMOTE_WAITLIST_CONF="${REMOTE_WAITLIST_CONF:-/etc/nginx/sites-available/leaf-waitlist-secure}"
REMOTE_SITES_ENABLED="${REMOTE_SITES_ENABLED:-/etc/nginx/sites-enabled}"

echo "📤 Enviando nginx-leaf-app-br.conf para ${SSH_HOST}:${REMOTE_LEAF_CONF}"
scp $SSH_OPTS "$LEAF_CONF" "${SSH_HOST}:/tmp/nginx-leaf-app-br.conf"

echo "📤 Enviando nginx-waitlist-secure.conf para ${SSH_HOST}:${REMOTE_WAITLIST_CONF}"
scp $SSH_OPTS "$WAITLIST_CONF" "${SSH_HOST}:/tmp/nginx-waitlist-secure.conf"

REMOTE_SCRIPT=$(cat <<'EOF'
set -euo pipefail

sudo mv /tmp/nginx-leaf-app-br.conf "$REMOTE_LEAF_CONF"
sudo mv /tmp/nginx-waitlist-secure.conf "$REMOTE_WAITLIST_CONF"

sudo ln -sf "$REMOTE_LEAF_CONF" "$REMOTE_SITES_ENABLED/leaf-app-br"
sudo ln -sf "$REMOTE_WAITLIST_CONF" "$REMOTE_SITES_ENABLED/leaf-waitlist-secure"

echo "🧪 Testando nginx..."
sudo nginx -t
echo "🔄 Recarregando nginx..."
sudo systemctl reload nginx
EOF
)

echo "🚀 Aplicando configurações e recarregando nginx em ${SSH_HOST}"
ssh $SSH_OPTS "$SSH_HOST" \
  REMOTE_LEAF_CONF="$REMOTE_LEAF_CONF" \
  REMOTE_WAITLIST_CONF="$REMOTE_WAITLIST_CONF" \
  REMOTE_SITES_ENABLED="$REMOTE_SITES_ENABLED" \
  'bash -s' <<< "$REMOTE_SCRIPT"

echo "✅ Deploy concluído."




















