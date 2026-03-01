#!/bin/bash

# Script para monitorar builds preview (Android e iOS)

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo ""
echo -e "${BLUE}📊 Monitorando Builds Preview${NC}"
echo ""

while true; do
    clear
    echo -e "${BLUE}════════════════════════════════════════${NC}"
    echo -e "${BLUE}   STATUS DOS BUILDS PREVIEW${NC}"
    echo -e "${BLUE}════════════════════════════════════════${NC}"
    echo ""
    
    echo -e "${YELLOW}📱 Android Preview:${NC}"
    npx eas build:list --platform android --limit 1 --non-interactive 2>/dev/null | grep -E "ID|Platform|Status|Profile" | head -4
    echo ""
    
    echo -e "${YELLOW}🍎 iOS Preview:${NC}"
    npx eas build:list --platform ios --limit 1 --non-interactive 2>/dev/null | grep -E "ID|Platform|Status|Profile" | head -4
    echo ""
    
    echo -e "${BLUE}════════════════════════════════════════${NC}"
    echo ""
    echo "Pressione Ctrl+C para sair"
    echo "Atualizando em 30 segundos..."
    sleep 30
done

