#!/bin/bash

# Script para buildar versão standalone REAL que funciona com Maestro
# Remove versão dev e instala versão standalone

set -e

# Cores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}🔨 Buildando Versão Standalone REAL${NC}"
echo "====================================="
echo ""

cd /home/izaak-dias/Downloads/leaf-project/mobile-app

# 1. Desinstalar versão dev
echo -e "${BLUE}1. Removendo versão dev...${NC}"
adb uninstall br.com.leaf.ride 2>/dev/null || true
echo -e "${GREEN}✅ Versão dev removida${NC}"
echo ""

# 2. Limpar builds anteriores
echo -e "${BLUE}2. Limpando builds anteriores...${NC}"
cd android
./gradlew clean > /dev/null 2>&1 || true
cd ..
echo -e "${GREEN}✅ Limpeza concluída${NC}"
echo ""

# 3. Build release
echo -e "${BLUE}3. Buildando versão release (standalone)...${NC}"
echo -e "${YELLOW}⏳ Isso pode levar 5-10 minutos...${NC}"
echo ""

npx expo run:android --variant release --no-build-cache

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Erro no build${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}✅ Build concluído!${NC}"
echo ""

# 4. Instalar
echo -e "${BLUE}4. Instalando no dispositivo...${NC}"
APK_PATH="android/app/build/outputs/apk/release/app-release.apk"

if [ ! -f "$APK_PATH" ]; then
    echo -e "${RED}❌ APK não encontrado em: $APK_PATH${NC}"
    exit 1
fi

adb install -r "$APK_PATH"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ App instalado!${NC}"
else
    echo -e "${RED}❌ Erro ao instalar${NC}"
    exit 1
fi

# 5. Testar se abre
echo ""
echo -e "${BLUE}5. Testando se app abre...${NC}"
sleep 2
adb shell am start -n br.com.leaf.ride/.MainActivity > /dev/null 2>&1
sleep 3

CURRENT_APP=$(adb shell dumpsys window | grep -E "mCurrentFocus" | head -1)

if echo "$CURRENT_APP" | grep -q "br.com.leaf.ride"; then
    if echo "$CURRENT_APP" | grep -q "DevLauncherActivity"; then
        echo -e "${RED}❌ Ainda é versão dev (pede expo start)${NC}"
        echo "   O build não gerou versão standalone"
    else
        echo -e "${GREEN}✅ App standalone funcionando!${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  Não foi possível verificar${NC}"
fi

echo ""
echo -e "${GREEN}✅ Processo concluído!${NC}"
echo ""
echo "Agora teste com Maestro:"
echo "  npm run test:e2e:device .maestro/flows/test-simple-launch.yaml"













