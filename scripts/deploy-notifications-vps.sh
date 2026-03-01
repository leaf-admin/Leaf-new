#!/bin/bash

# 🚀 Deploy da rota de notificações para VPS
# Envia os arquivos atualizados e reinicia o servidor

set -e

VPS_IP="216.238.107.59"
VPS_USER="root"
VPS_PATH="/root/leaf-websocket-backend"

echo "🚀 DEPLOY DA ROTA DE NOTIFICAÇÕES PARA VPS"
echo "=========================================="
echo "📡 VPS: $VPS_USER@$VPS_IP"
echo "📁 Path: $VPS_PATH"
echo ""

# Verificar se os arquivos existem
if [ ! -f "leaf-websocket-backend/server.js" ]; then
    echo "❌ Erro: server.js não encontrado!"
    exit 1
fi

if [ ! -f "leaf-websocket-backend/routes/notifications.js" ]; then
    echo "❌ Erro: routes/notifications.js não encontrado!"
    exit 1
fi

echo "📤 Enviando arquivos atualizados..."
scp leaf-websocket-backend/server.js $VPS_USER@$VPS_IP:$VPS_PATH/server.js
scp leaf-websocket-backend/routes/notifications.js $VPS_USER@$VPS_IP:$VPS_PATH/routes/notifications.js

echo "✅ Arquivos enviados!"
echo ""

echo "🔄 Reiniciando servidor na VPS..."
ssh $VPS_USER@$VPS_IP << 'EOF'
cd /root/leaf-websocket-backend

# Fazer backup do server.js atual
if [ -f "server.js" ]; then
    cp server.js server.js.backup-$(date +%Y%m%d-%H%M%S)
fi

# Parar servidor atual (se estiver rodando via PM2)
pm2 stop leaf-websocket-backend 2>/dev/null || echo "PM2 não está rodando"

# Parar processo direto (se estiver rodando)
pkill -f "node.*server.js" 2>/dev/null || echo "Nenhum processo encontrado"

# Aguardar um pouco
sleep 2

# Iniciar servidor novamente
echo "🚀 Iniciando servidor..."
pm2 start server.js --name leaf-websocket-backend 2>/dev/null || \
nohup node server.js > server.log 2>&1 &

echo "✅ Servidor reiniciado!"
EOF

echo ""
echo "⏳ Aguardando servidor inicializar..."
sleep 5

echo "🔍 Testando rota de notificações..."
RESPONSE=$(curl -s -X POST http://$VPS_IP:3001/api/notifications/send \
  -H "Content-Type: application/json" \
  -d '{"userIds":["test"],"title":"Teste","body":"Mensagem"}' 2>&1)

if echo "$RESPONSE" | grep -q "success\|error"; then
    echo "✅ Rota de notificações está funcionando!"
    echo "📋 Resposta: $RESPONSE" | head -c 200
else
    echo "⚠️ Resposta inesperada: $RESPONSE" | head -c 200
fi

echo ""
echo "🎯 DEPLOY CONCLUÍDO!"
echo "==================="
echo "🌐 Teste em: http://$VPS_IP:3001/api/notifications/send"

