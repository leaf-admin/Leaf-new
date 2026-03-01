#!/bin/bash

# Script para testar se app abre manualmente
# Útil para verificar se está funcionando antes do Maestro

set -e

# Cores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}📱 Testando Abertura Manual do App${NC}"
echo "=============================="
echo ""

# Verificar dispositivo
DEVICES=$(adb devices | grep -v "List" | grep "device" | grep -v "^$")

if [ -z "$DEVICES" ]; then
    echo -e "${RED}❌ Nenhum dispositivo encontrado${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Dispositivo conectado${NC}"
echo ""

# Verificar se app está instalado
APP_INSTALLED=$(adb shell pm list packages | grep "br.com.leaf.ride" || echo "")

if [ -z "$APP_INSTALLED" ]; then
    echo -e "${RED}❌ App não instalado${NC}"
    echo "   Execute: npm run android"
    exit 1
fi

echo -e "${GREEN}✅ App instalado${NC}"
echo ""

echo -e "${BLUE}🚀 Abrindo app...${NC}"
echo -e "${YELLOW}👀 Olhe o celular agora!${NC}"
echo ""

# Fechar app se estiver aberto
adb shell am force-stop br.com.leaf.ride 2>/dev/null || true
sleep 1

# Abrir app
adb shell am start -n br.com.leaf.ride/.MainActivity

sleep 3

echo ""
echo -e "${BLUE}📋 O que apareceu no celular?${NC}"
echo ""
echo "1. ✅ App abriu direto na tela inicial"
echo "   → App standalone OK! Só falta resolver permissão do Maestro"
echo ""
echo "2. ❌ Tela pedindo 'npx expo start'"
echo "   → Precisa buildar versão standalone:"
echo "     npx expo run:android --variant release"
echo ""
echo "3. ❌ App não abriu / Erro"
echo "   → Verifique logs: adb logcat | grep -i error"













