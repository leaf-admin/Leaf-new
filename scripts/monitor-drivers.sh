#!/bin/bash
echo "🔍 Monitorando conexões de drivers no servidor..."
ssh root@216.238.107.59 "tail -f /root/leaf-websocket-backend/server.log 2>/dev/null | grep --line-buffered -E 'Driver.*room|Customer.*room|authenticated|🔐|🚗' || echo 'Aguardando conexões...'"
