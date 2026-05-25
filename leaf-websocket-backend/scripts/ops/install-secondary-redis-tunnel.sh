#!/bin/bash

set -euo pipefail

PRIMARY_SSH_HOST="${PRIMARY_SSH_HOST:-}"
PRIMARY_SSH_USER="${PRIMARY_SSH_USER:-root}"
PRIMARY_SSH_PORT="${PRIMARY_SSH_PORT:-22}"
PRIMARY_REDIS_HOST="${PRIMARY_REDIS_HOST:-127.0.0.1}"
PRIMARY_REDIS_PORT="${PRIMARY_REDIS_PORT:-6379}"
LOCAL_REDIS_PORT="${LOCAL_REDIS_PORT:-6381}"
TUNNEL_KEY_PATH="${TUNNEL_KEY_PATH:-/root/.ssh/leaf-primary-redis}"

if [ -z "$PRIMARY_SSH_HOST" ]; then
    echo "PRIMARY_SSH_HOST é obrigatório" >&2
    exit 1
fi

if [ ! -f "$TUNNEL_KEY_PATH" ]; then
    echo "Chave do túnel não encontrada em $TUNNEL_KEY_PATH" >&2
    exit 1
fi

if ! command -v ssh >/dev/null 2>&1; then
    echo "ssh não encontrado" >&2
    exit 1
fi

cat >/etc/systemd/system/leaf-redis-tunnel.service <<EOF
[Unit]
Description=Leaf Redis Tunnel to Primary Realtime Host
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
Restart=always
RestartSec=5
ExecStart=/usr/bin/ssh -NT \\
  -o ExitOnForwardFailure=yes \\
  -o ServerAliveInterval=30 \\
  -o ServerAliveCountMax=3 \\
  -o StrictHostKeyChecking=no \\
  -p ${PRIMARY_SSH_PORT} \\
  -i ${TUNNEL_KEY_PATH} \\
  -L 127.0.0.1:${LOCAL_REDIS_PORT}:${PRIMARY_REDIS_HOST}:${PRIMARY_REDIS_PORT} \\
  ${PRIMARY_SSH_USER}@${PRIMARY_SSH_HOST}

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now leaf-redis-tunnel.service
systemctl --no-pager --full status leaf-redis-tunnel.service
