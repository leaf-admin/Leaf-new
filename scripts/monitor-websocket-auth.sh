#!/bin/bash
echo "🔍 Monitorando autenticações WebSocket em tempo real..."
echo "📊 Servidor: http://147.182.204.181:3001"
echo ""
echo "Aguardando drivers se autenticarem..."
echo ""

ssh root@147.182.204.181 "tail -f /opt/leaf-app/server.log" | grep --line-buffered -E 'Driver.*adicionado|Customer.*adicionado|autenticado|🚗|👤|🔐' | sed 's/.*🔐 Usuário autenticado: /🔐 /' | sed 's/.*🚗 Driver /🚗 Driver /' | sed 's/.*👤 Customer /👤 Customer /'


