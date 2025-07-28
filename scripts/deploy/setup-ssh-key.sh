#!/bin/bash

echo "🔑 CONFIGURANDO SSH COM CHAVE PÚBLICA"
echo "======================================"

# Verificar se a chave privada existe
if [ ! -f ~/.ssh/id_ed25519 ]; then
    echo "🔑 Gerando par de chaves SSH..."
    ssh-keygen -t ed25519 -C "admin@leaf.app.br" -f ~/.ssh/id_ed25519 -N ""
    echo "✅ Chave SSH gerada!"
else
    echo "✅ Chave SSH já existe!"
fi

# Mostrar a chave pública
echo ""
echo "🔑 SUA CHAVE PÚBLICA:"
echo "====================="
cat ~/.ssh/id_ed25519.pub

echo ""
echo "📋 INSTRUÇÕES:"
echo "=============="
echo "1. Copie a chave pública acima"
echo "2. Adicione ela no painel da Hostinger ou via SSH:"
echo "   ssh root@147.93.66.253 'echo \"SUA_CHAVE_AQUI\" >> ~/.ssh/authorized_keys'"
echo ""
echo "3. Teste a conexão:"
echo "   ssh root@147.93.66.253 'echo \"Teste SSH\"'"
echo ""
echo "🔧 Alternativa - Configurar via Hostinger:"
echo "1. Acesse o painel da Hostinger"
echo "2. Vá em SSH Keys"
echo "3. Adicione a chave pública acima"
echo "4. Aguarde alguns minutos e teste novamente" 