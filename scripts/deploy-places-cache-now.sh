#!/bin/bash

# 🚀 DEPLOY RÁPIDO - Places Cache + Correções
# Deploy direto via SSH/rsync

set -e

VPS_IP="216.238.107.59"
VPS_USER="root"
VPS_PATH="/root/leaf-websocket-backend"

echo "🚀 Deploy do Places Cache para VPS..."

# Verificar se rsync está disponível
if ! command -v rsync &> /dev/null; then
    echo "❌ rsync não encontrado. Instalando..."
    sudo apt-get update && sudo apt-get install -y rsync
fi

# Verificar se estamos no diretório correto
if [ ! -f "leaf-websocket-backend/server.js" ]; then
    echo "❌ Execute este script no diretório raiz do projeto!"
    exit 1
fi

echo "📦 Copiando arquivos para VPS..."

# Copiar arquivos essenciais
rsync -avz --progress \
    --exclude 'node_modules' \
    --exclude '.git' \
    --exclude '*.log' \
    --exclude 'minio-config' \
    leaf-websocket-backend/server.js \
    leaf-websocket-backend/routes/places-routes.js \
    leaf-websocket-backend/services/places-cache-service.js \
    leaf-websocket-backend/utils/places-normalizer.js \
    leaf-websocket-backend/package.json \
    ${VPS_USER}@${VPS_IP}:${VPS_PATH}/

echo "📦 Instalando dependências na VPS..."

# Instalar dependências e reiniciar
ssh ${VPS_USER}@${VPS_IP} << 'ENDSSH'
cd /root/leaf-websocket-backend

# Instalar dependências se necessário
if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules/.package-lock.json" ]; then
    echo "📦 Instalando dependências..."
    npm install --production
fi

# Parar processo atual
echo "🛑 Parando servidor..."
pkill -f "node.*server.js" || true
lsof -ti:3001 | xargs kill -9 2>/dev/null || true
sleep 2

# Iniciar servidor
echo "🚀 Iniciando servidor..."
nohup node server.js > server.log 2>&1 &
sleep 5

# Verificar se está rodando
if curl -s http://localhost:3001/health > /dev/null; then
    echo "✅ Servidor reiniciado com sucesso!"
    echo "📊 Verificando Places Cache..."
    curl -s http://localhost:3001/api/places/health | head -20
else
    echo "❌ Erro ao iniciar servidor"
    tail -30 server.log
    exit 1
fi
ENDSSH

echo ""
echo "✅ Deploy concluído!"
echo "🔍 Teste: curl http://${VPS_IP}:3001/api/places/health"







