#!/bin/bash

echo "🚀 Instalando versão atualizada na VPS..."

# Parar serviço atual
pm2 stop leaf-websocket-server 2>/dev/null || echo "Serviço não estava rodando"

# Backup do servidor atual
cp server.js server.js.backup-$(date +%Y%m%d-%H%M%S) 2>/dev/null || echo "Sem backup anterior"

# Instalar dependências se necessário
if [ ! -d "node_modules" ]; then
    echo "📦 Instalando dependências..."
    npm install
fi

# Iniciar serviço atualizado
echo "🚀 Iniciando servidor atualizado..."
pm2 start server.js --name leaf-websocket-server

# Verificar status
pm2 status

echo "✅ Deploy concluído!"
echo "🔍 Teste: curl http://localhost:3001/health"
