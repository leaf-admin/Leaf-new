#!/bin/bash

# ===================================
# Script para configurar Nginx para Waitlist API
# ===================================
# Este script configura o nginx para rotear /api/* para o backend Node.js
# na porta 3001, permitindo que a landing page na Cloudflare faça requisições

set -e

echo "🍃 Configurando Nginx para Leaf App - Waitlist API"
echo "=================================================="

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Verificar se está rodando como root
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}❌ Por favor, execute como root (sudo)${NC}"
    exit 1
fi

# Caminho do arquivo de configuração
CONFIG_FILE="/etc/nginx/sites-available/leaf-app-br"
CONFIG_SOURCE="$(dirname "$0")/../../../config/nginx/nginx-leaf-app-br.conf"

# Verificar se o arquivo fonte existe
if [ ! -f "$CONFIG_SOURCE" ]; then
    echo -e "${RED}❌ Arquivo de configuração não encontrado: $CONFIG_SOURCE${NC}"
    exit 1
fi

echo -e "${YELLOW}📋 Copiando configuração...${NC}"
cp "$CONFIG_SOURCE" "$CONFIG_FILE"

# Criar link simbólico se não existir
if [ ! -L "/etc/nginx/sites-enabled/leaf-app-br" ]; then
    echo -e "${YELLOW}🔗 Criando link simbólico...${NC}"
    ln -s "$CONFIG_FILE" /etc/nginx/sites-enabled/leaf-app-br
fi

# Verificar se o backend está rodando na porta 3001
echo -e "${YELLOW}🔍 Verificando se o backend está rodando na porta 3001...${NC}"
if ! netstat -tuln | grep -q ":3001 "; then
    echo -e "${YELLOW}⚠️  Backend não está rodando na porta 3001${NC}"
    echo -e "${YELLOW}   Certifique-se de que o servidor Node.js está ativo${NC}"
fi

# Testar configuração do nginx
echo -e "${YELLOW}🧪 Testando configuração do nginx...${NC}"
if nginx -t; then
    echo -e "${GREEN}✅ Configuração do nginx está válida${NC}"
else
    echo -e "${RED}❌ Erro na configuração do nginx${NC}"
    exit 1
fi

# Recarregar nginx
echo -e "${YELLOW}🔄 Recarregando nginx...${NC}"
systemctl reload nginx

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Nginx recarregado com sucesso${NC}"
    echo ""
    echo -e "${GREEN}✅ Configuração concluída!${NC}"
    echo ""
    echo "📝 Próximos passos:"
    echo "   1. Verifique se o backend está rodando: pm2 list"
    echo "   2. Teste o endpoint: curl https://leaf.app.br/api/waitlist/landing"
    echo "   3. Verifique os logs: tail -f /var/log/nginx/leaf-app-br-error.log"
else
    echo -e "${RED}❌ Erro ao recarregar nginx${NC}"
    exit 1
fi






















