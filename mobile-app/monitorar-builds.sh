#!/bin/bash

# Script para monitorar builds em andamento

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}════════════════════════════════════════${NC}"
echo -e "${BLUE}   MONITORAMENTO DE BUILDS${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo ""

while true; do
    echo -e "${GREEN}📊 Status dos builds (atualizado a cada 30s)${NC}"
    echo ""
    
    # Android
    echo -e "${BLUE}📱 Android Preview:${NC}"
    ANDROID_BUILD=$(npx eas build:list --platform android --limit 1 --non-interactive 2>&1 | grep -E "ID|Status|Platform" | head -3)
    if echo "$ANDROID_BUILD" | grep -q "in-progress\|in_progress\|pending\|queued"; then
        echo -e "${YELLOW}   ⏳ Em andamento...${NC}"
        echo "$ANDROID_BUILD" | sed 's/^/   /'
    elif echo "$ANDROID_BUILD" | grep -q "finished\|completed"; then
        echo -e "${GREEN}   ✅ Concluído!${NC}"
        echo "$ANDROID_BUILD" | sed 's/^/   /'
        ANDROID_DONE=true
    elif echo "$ANDROID_BUILD" | grep -q "errored\|failed"; then
        echo -e "${RED}   ❌ Falhou${NC}"
        echo "$ANDROID_BUILD" | sed 's/^/   /'
        ANDROID_DONE=true
    else
        echo "$ANDROID_BUILD" | sed 's/^/   /'
    fi
    
    echo ""
    
    # iOS
    echo -e "${BLUE}🍎 iOS Preview:${NC}"
    IOS_BUILD=$(npx eas build:list --platform ios --limit 1 --non-interactive 2>&1 | grep -E "ID|Status|Platform" | head -3)
    if echo "$IOS_BUILD" | grep -q "in-progress\|in_progress\|pending\|queued"; then
        echo -e "${YELLOW}   ⏳ Em andamento...${NC}"
        echo "$IOS_BUILD" | sed 's/^/   /'
    elif echo "$IOS_BUILD" | grep -q "finished\|completed"; then
        echo -e "${GREEN}   ✅ Concluído!${NC}"
        echo "$IOS_BUILD" | sed 's/^/   /'
        IOS_DONE=true
    elif echo "$IOS_BUILD" | grep -q "errored\|failed"; then
        echo -e "${RED}   ❌ Falhou${NC}"
        echo "$IOS_BUILD" | sed 's/^/   /'
        IOS_DONE=true
    else
        echo "$IOS_BUILD" | sed 's/^/   /'
    fi
    
    echo ""
    echo -e "${BLUE}────────────────────────────────────${NC}"
    echo ""
    
    # Verificar se ambos concluíram
    if [ "${ANDROID_DONE:-false}" = "true" ] && [ "${IOS_DONE:-false}" = "true" ]; then
        echo -e "${GREEN}✅ Ambos os builds finalizaram!${NC}"
        echo ""
        echo "Para ver detalhes completos:"
        echo "  npx eas build:list --platform android --limit 1"
        echo "  npx eas build:list --platform ios --limit 1"
        break
    fi
    
    echo "Aguardando 30 segundos..."
    sleep 30
    clear
done

