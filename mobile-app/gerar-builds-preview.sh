#!/bin/bash

# Script para gerar builds preview (Android e iOS)

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}════════════════════════════════════════${NC}"
echo -e "${BLUE}   GERAR BUILDS PREVIEW${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo ""

# Verificar se está no diretório correto
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ Erro: Execute este script dentro de mobile-app/${NC}"
    exit 1
fi

# Verificar autenticação
echo -e "${GREEN}✅ Verificando autenticação EAS...${NC}"
EAS_USER=$(npx eas whoami 2>&1)
if echo "$EAS_USER" | grep -q "Not logged in"; then
    echo -e "${RED}❌ Não autenticado no EAS${NC}"
    echo -e "${YELLOW}Execute: npx eas login${NC}"
    exit 1
fi
echo -e "${GREEN}   ✅ Autenticado${NC}"
echo ""

# Perguntar quais builds gerar
echo "Qual build deseja gerar?"
echo "  1. Android Preview"
echo "  2. iOS Preview"
echo "  3. Ambos (Android + iOS)"
echo ""
read -p "Escolha (1-3): " choice

case $choice in
    1)
        echo ""
        echo -e "${BLUE}🚀 Gerando build Android Preview...${NC}"
        echo ""
        npx eas build --platform android --profile preview
        ;;
    2)
        echo ""
        echo -e "${BLUE}🍎 Gerando build iOS Preview...${NC}"
        echo ""
        npx eas build --platform ios --profile preview
        ;;
    3)
        echo ""
        echo -e "${BLUE}🚀 Gerando build Android Preview...${NC}"
        npx eas build --platform android --profile preview &
        ANDROID_PID=$!
        
        echo ""
        echo -e "${BLUE}🍎 Gerando build iOS Preview...${NC}"
        npx eas build --platform ios --profile preview &
        IOS_PID=$!
        
        echo ""
        echo -e "${GREEN}✅ Builds iniciados em background${NC}"
        echo "   Android PID: $ANDROID_PID"
        echo "   iOS PID: $IOS_PID"
        echo ""
        echo "Para monitorar:"
        echo "   npx eas build:list --platform android --limit 1"
        echo "   npx eas build:list --platform ios --limit 1"
        ;;
    *)
        echo -e "${RED}❌ Opção inválida${NC}"
        exit 1
        ;;
esac

echo ""
echo -e "${GREEN}✅ Processo concluído!${NC}"
echo ""
echo "Para monitorar os builds:"
echo "   npx eas build:list --platform android --limit 1"
echo "   npx eas build:list --platform ios --limit 1"
echo ""
echo "Para baixar quando concluir:"
echo "   npx eas build:download --platform android --latest"
echo "   npx eas build:download --platform ios --latest"
echo ""

