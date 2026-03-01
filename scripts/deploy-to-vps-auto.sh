#!/bin/bash

echo "🚀 DEPLOY AUTOMÁTICO PARA VPS..."

VPS_IP="216.238.107.59"
VPS_USER="root"
VPS_PATH="/root/leaf-backend"

# Verificar se SSH está configurado
if ! ssh -o ConnectTimeout=5 $VPS_USER@$VPS_IP "echo 'SSH OK'" 2>/dev/null; then
    echo "❌ SSH não configurado. Use deploy manual."
    echo "📋 Instruções em deploy-package/README-DEPLOY.md"
    exit 1
fi

echo "📤 Fazendo upload dos arquivos..."
scp -r deploy-package/* $VPS_USER@$VPS_IP:$VPS_PATH/

echo "🚀 Executando instalação na VPS..."
ssh $VPS_USER@$VPS_IP "cd $VPS_PATH && chmod +x install-on-vps.sh && ./install-on-vps.sh"

echo "✅ Deploy automático concluído!"
echo "🧪 Testando..."
curl -s http://$VPS_IP:3001/health | jq .
