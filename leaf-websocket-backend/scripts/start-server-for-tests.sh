#!/bin/bash

# Script para iniciar servidor para testes

echo "🚀 Iniciando servidor para testes..."
echo ""

# Verificar se Redis está rodando
if ! redis-cli ping > /dev/null 2>&1; then
    echo "⚠️ Redis não está rodando. Iniciando Redis..."
    echo "💡 Execute: redis-server (ou docker run -d -p 6379:6379 redis)"
    exit 1
fi

echo "✅ Redis está rodando"

# Verificar se porta está livre
if lsof -Pi :3001 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "⚠️ Porta 3001 já está em uso"
    echo "💡 Pare o servidor existente ou use outra porta"
    exit 1
fi

echo "✅ Porta 3001 está livre"

# Iniciar servidor
echo ""
echo "🚀 Iniciando servidor Node.js..."
echo "📝 Logs serão exibidos abaixo"
echo "💡 Pressione Ctrl+C para parar"
echo ""
echo "=" .repeat(60)
echo ""

cd "$(dirname "$0")/../.."
node server.js

