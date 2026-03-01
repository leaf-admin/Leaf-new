#!/bin/bash

# Script para iniciar o servidor Node.js do Leaf WebSocket Backend

echo "🚀 Iniciando servidor Node.js..."

# Verificar se a porta 3001 está livre
if lsof -i :3001 > /dev/null 2>&1; then
    echo "❌ Porta 3001 já está em uso"
    echo "📋 Processos usando a porta:"
    lsof -i :3001
    exit 1
fi

# Verificar se o arquivo server.js existe
if [ ! -f "server.js" ]; then
    echo "❌ Arquivo server.js não encontrado"
    exit 1
fi

# Verificar se as dependências estão instaladas
if [ ! -d "node_modules" ]; then
    echo "📦 Instalando dependências..."
    npm install
fi

# Configurar variáveis de ambiente
export PORT=3001
export NODE_ENV=development
export INSTANCE_ID=websocket_main
export CLUSTER_MODE=false

echo "🔧 Configurações:"
echo "   Porta: $PORT"
echo "   Ambiente: $NODE_ENV"
echo "   Instância: $INSTANCE_ID"
echo "   Cluster: $CLUSTER_MODE"

# Iniciar o servidor
echo "🔄 Iniciando servidor..."
nohup node server.js > server.log 2>&1 &

# Aguardar um pouco para o servidor inicializar
sleep 3

# Verificar se o servidor está rodando
if curl -s http://localhost:3001/health > /dev/null 2>&1; then
    echo "✅ Servidor iniciado com sucesso!"
    echo "🌐 URL: http://localhost:3001"
    echo "📊 Health: http://localhost:3001/health"
    echo "🔐 Auth: http://localhost:3001/api/auth/login"
    echo "📋 Logs: tail -f server.log"
else
    echo "❌ Servidor não está respondendo"
    echo "📋 Últimas linhas do log:"
    tail -5 server.log
    exit 1
fi
