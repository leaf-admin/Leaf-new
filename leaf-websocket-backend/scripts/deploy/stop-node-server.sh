#!/bin/bash

# Script para parar o servidor Node.js do Leaf WebSocket Backend

echo "🛑 Parando servidor Node.js..."

# Encontrar e parar o processo do servidor
PID=$(ps aux | grep "node.*server.js" | grep -v grep | awk '{print $2}')

if [ -n "$PID" ]; then
    echo "📋 Processo encontrado: PID $PID"
    echo "🔄 Tentando parar o processo..."
    
    # Tentar parar graciosamente primeiro
    kill $PID
    
    # Aguardar um pouco
    sleep 3
    
    # Verificar se ainda está rodando
    if ps -p $PID > /dev/null 2>&1; then
        echo "⚠️ Processo ainda rodando, forçando parada..."
        kill -9 $PID
        sleep 1
    fi
    
    # Verificar se foi parado
    if ps -p $PID > /dev/null 2>&1; then
        echo "❌ Não foi possível parar o processo"
        exit 1
    else
        echo "✅ Servidor parado com sucesso!"
    fi
else
    echo "ℹ️ Nenhum servidor Node.js encontrado rodando"
fi

# Verificar se a porta 3001 está livre
if lsof -i :3001 > /dev/null 2>&1; then
    echo "⚠️ Porta 3001 ainda está em uso"
else
    echo "✅ Porta 3001 liberada"
fi
