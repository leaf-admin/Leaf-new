#!/usr/bin/env bash

set -euo pipefail

EMAIL="${1:-}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WEBROOT_DIR="$ROOT_DIR/certbot/www"
CERTBOT_CONF_DIR="$ROOT_DIR/certbot/conf"
CERTBOT_WORK_DIR="$ROOT_DIR/certbot/work"
CERTBOT_LOG_DIR="$ROOT_DIR/certbot/logs"
DOMAINS=(
  "api.leaf.app.br"
  "socket.leaf.app.br"
  "dashboard.leaf.app.br"
)

mkdir -p "$WEBROOT_DIR" "$CERTBOT_CONF_DIR" "$CERTBOT_WORK_DIR" "$CERTBOT_LOG_DIR"

echo "Emitindo certificado Let's Encrypt para ${DOMAINS[*]}..."

CERTBOT_ARGS=(
  certonly
  --non-interactive
  --agree-tos
  --webroot
  -w /var/www/certbot
)

if [[ -n "$EMAIL" ]]; then
  CERTBOT_ARGS+=(--email "$EMAIL")
else
  CERTBOT_ARGS+=(--register-unsafely-without-email)
fi

for domain in "${DOMAINS[@]}"; do
  CERTBOT_ARGS+=(-d "$domain")
done

docker run --rm \
  -v "$WEBROOT_DIR:/var/www/certbot" \
  -v "$CERTBOT_CONF_DIR:/etc/letsencrypt" \
  -v "$CERTBOT_WORK_DIR:/var/lib/letsencrypt" \
  -v "$CERTBOT_LOG_DIR:/var/log/letsencrypt" \
  certbot/certbot:latest "${CERTBOT_ARGS[@]}"

echo "Certificado emitido em $CERTBOT_CONF_DIR/live/${DOMAINS[0]}"
echo "Próximo passo: habilitar o bloco TLS do nginx e reiniciar o proxy."
