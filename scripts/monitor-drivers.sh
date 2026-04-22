#!/bin/bash
echo "🔍 Monitorando conexões de drivers no servidor..."
ssh root@147.182.204.181 "tail -f /opt/leaf-app/server.log 2>/dev/null | grep --line-buffered -E 'Driver.*room|Customer.*room|authenticated|🔐|🚗' || echo 'Aguardando conexões...'"
