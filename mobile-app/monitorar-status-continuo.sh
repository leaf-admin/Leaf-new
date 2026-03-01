#!/bin/bash

# Monitoramento contínuo dos builds

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${BLUE}════════════════════════════════════════${NC}"
echo -e "${BLUE}   MONITORAMENTO DE BUILDS EAS${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo ""

ANDROID_DONE=false
IOS_DONE=false
ITERATION=0

while true; do
    ITERATION=$((ITERATION + 1))
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}Verificação #${ITERATION} - $(date '+%H:%M:%S')${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    
    # Android
    if [ "$ANDROID_DONE" = false ]; then
        echo -e "${BLUE}📱 Android Preview:${NC}"
        ANDROID_INFO=$(npx eas build:list --platform android --limit 1 --non-interactive 2>&1)
        ANDROID_STATUS=$(echo "$ANDROID_INFO" | grep -i "Status" | head -1 | awk '{print $2}')
        ANDROID_ID=$(echo "$ANDROID_INFO" | grep "ID" | head -1 | awk '{print $2}')
        
        if [ -z "$ANDROID_STATUS" ]; then
            echo -e "${YELLOW}   ⏳ Aguardando build iniciar...${NC}"
        elif echo "$ANDROID_STATUS" | grep -qiE "in-progress|in_progress|pending|queued"; then
            echo -e "${YELLOW}   ⏳ Em andamento...${NC}"
            echo "   ID: $ANDROID_ID"
            echo "   Status: $ANDROID_STATUS"
        elif echo "$ANDROID_STATUS" | grep -qiE "finished|completed"; then
            echo -e "${GREEN}   ✅ CONCLUÍDO!${NC}"
            echo "   ID: $ANDROID_ID"
            echo "   Status: $ANDROID_STATUS"
            ANDROID_DONE=true
        elif echo "$ANDROID_STATUS" | grep -qiE "errored|failed"; then
            echo -e "${RED}   ❌ FALHOU${NC}"
            echo "   ID: $ANDROID_ID"
            echo "   Status: $ANDROID_STATUS"
            echo "   Logs: https://expo.dev/accounts/leaf-app/projects/leafapp-reactnative/builds/$ANDROID_ID"
            ANDROID_DONE=true
        else
            echo "   Status: $ANDROID_STATUS"
            echo "   ID: $ANDROID_ID"
        fi
    else
        echo -e "${BLUE}📱 Android Preview:${NC} ${GREEN}✅ Finalizado${NC}"
    fi
    
    echo ""
    
    # iOS
    if [ "$IOS_DONE" = false ]; then
        echo -e "${BLUE}🍎 iOS Preview:${NC}"
        IOS_INFO=$(npx eas build:list --platform ios --limit 1 --non-interactive 2>&1)
        IOS_STATUS=$(echo "$IOS_INFO" | grep -i "Status" | head -1 | awk '{print $2}')
        IOS_ID=$(echo "$IOS_INFO" | grep "ID" | head -1 | awk '{print $2}')
        
        if [ -z "$IOS_STATUS" ]; then
            echo -e "${YELLOW}   ⏳ Aguardando build iniciar...${NC}"
        elif echo "$IOS_STATUS" | grep -qiE "in-progress|in_progress|pending|queued"; then
            echo -e "${YELLOW}   ⏳ Em andamento...${NC}"
            echo "   ID: $IOS_ID"
            echo "   Status: $IOS_STATUS"
        elif echo "$IOS_STATUS" | grep -qiE "finished|completed"; then
            echo -e "${GREEN}   ✅ CONCLUÍDO!${NC}"
            echo "   ID: $IOS_ID"
            echo "   Status: $IOS_STATUS"
            IOS_DONE=true
        elif echo "$IOS_STATUS" | grep -qiE "errored|failed"; then
            echo -e "${RED}   ❌ FALHOU${NC}"
            echo "   ID: $IOS_ID"
            echo "   Status: $IOS_STATUS"
            echo "   Logs: https://expo.dev/accounts/leaf-app/projects/leafapp-reactnative/builds/$IOS_ID"
            IOS_DONE=true
        else
            echo "   Status: $IOS_STATUS"
            echo "   ID: $IOS_ID"
        fi
    else
        echo -e "${BLUE}🍎 iOS Preview:${NC} ${GREEN}✅ Finalizado${NC}"
    fi
    
    echo ""
    
    # Verificar se ambos concluíram
    if [ "$ANDROID_DONE" = true ] && [ "$IOS_DONE" = true ]; then
        echo -e "${GREEN}════════════════════════════════════════${NC}"
        echo -e "${GREEN}   ✅ AMBOS OS BUILDS FINALIZARAM!${NC}"
        echo -e "${GREEN}════════════════════════════════════════${NC}"
        echo ""
        echo "Para ver detalhes completos:"
        echo "  npx eas build:list --platform android --limit 1"
        echo "  npx eas build:list --platform ios --limit 1"
        echo ""
        echo "Para baixar os builds:"
        echo "  npx eas build:download --platform android --latest"
        echo "  npx eas build:download --platform ios --latest"
        break
    fi
    
    echo -e "${CYAN}Próxima verificação em 30 segundos...${NC}"
    echo ""
    sleep 30
done

