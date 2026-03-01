#!/bin/bash

# Script para parar cluster de servidores WebSocket

echo "🛑 PARANDO CLUSTER DE SERVIDORES WEBSOCKET"

# Parar todos os servidores Node.js
echo "🔄 Parando servidores Node.js..."
pkill -f "node server.js"

# Aguardar processos terminarem
sleep 3

# Verificar se ainda há processos rodando
if pgrep -f "node server.js" > /dev/null; then
    echo "⚠️ Forçando parada de processos restantes..."
    pkill -9 -f "node server.js"
    sleep 2
fi

# Verificar status final
echo "🔍 Verificando status final..."
if pgrep -f "node server.js" > /dev/null; then
    echo "❌ Ainda há processos rodando:"
    pgrep -f "node server.js"
else
    echo "✅ Todos os servidores parados com sucesso"
fi

# Limpar arquivo de PIDs
if [ -f cluster.pids ]; then
    rm -f cluster.pids
    echo "🗑️ Arquivo de PIDs removido"
fi

echo "🏁 Cluster parado com sucesso!"






