#!/bin/bash

# Script de Configuração Rápida para Vultr
# Configure o IP da sua VPS e execute

set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 CONFIGURAÇÃO RÁPIDA PARA VPS VULTR${NC}"
echo "============================================="

# Solicitar IP da Vultr
echo -e "${YELLOW}📝 Digite o IP da sua VPS Vultr:${NC}"
read -p "IP: " VULTR_IP

if [ -z "$VULTR_IP" ]; then
    echo -e "${RED}❌ IP não fornecido. Abortando.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ IP configurado: $VULTR_IP${NC}"

# Configurar script de deploy
echo -e "${BLUE}🔧 Configurando script de deploy...${NC}"
sed -i "s/VULTR_IP=\"\"/VULTR_IP=\"$VULTR_IP\"/" deploy-to-vultr.sh

echo -e "${GREEN}✅ Script configurado com sucesso!${NC}"

# Mostrar próximos passos
echo -e "\n${BLUE}🎯 PRÓXIMOS PASSOS:${NC}"
echo "=================="
echo -e "1. ${YELLOW}Verificar chave SSH:${NC} ls -la ~/.ssh/id_rsa"
echo -e "2. ${YELLOW}Testar conexão:${NC} ssh root@$VULTR_IP"
echo -e "3. ${YELLOW}Executar deploy:${NC} ./deploy-to-vultr.sh"
echo -e "4. ${YELLOW}Aguardar inicialização:${NC} ~5 minutos"
echo -e "5. ${YELLOW}Testar sistema:${NC} http://$VULTR_IP/health"

echo -e "\n${GREEN}🎉 Configuração concluída!${NC}"
echo -e "${BLUE}🚀 Execute: ./deploy-to-vultr.sh${NC}"






