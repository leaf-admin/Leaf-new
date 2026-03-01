#!/bin/bash
echo "🔍 Monitorando autenticações WebSocket em tempo real..."
echo "📊 Servidor: http://216.238.107.59:3001"
echo ""
echo "Aguardando drivers se autenticarem..."
echo ""

ssh root@216.238.107.59 "tail -f /root/leaf-websocket-backend/server.log" | grep --line-buffered -E 'Driver.*adicionado|Customer.*adicionado|autenticado|🚗|👤|🔐' | sed 's/.*🔐 Usuário autenticado: /🔐 /' | sed 's/.*🚗 Driver /🚗 Driver /' | sed 's/.*👤 Customer /👤 Customer /'


