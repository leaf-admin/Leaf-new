#!/bin/bash

# 🚀 Script simplificado para build de desenvolvimento
# Usa expo run:android que já faz prebuild automaticamente

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}🚀 Criando build de desenvolvimento${NC}"
echo ""

# Verificar se está no diretório correto
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ Execute este script dentro do diretório mobile-app${NC}"
    exit 1
fi

# Verificar se node_modules existe
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}📦 Instalando dependências...${NC}"
    npm install --legacy-peer-deps || yarn install
fi

echo -e "${GREEN}✅ Dependências OK${NC}"
echo ""

# Usar expo run:android que faz tudo automaticamente
echo -e "${YELLOW}🔨 Compilando APK de desenvolvimento...${NC}"
echo -e "${YELLOW}   (Isso pode demorar alguns minutos na primeira vez)${NC}"
echo ""

# Expo run:android faz prebuild + build automaticamente
npx expo run:android --variant debug --no-install

echo ""
echo -e "${GREEN}✅ Build concluída!${NC}"
echo ""

# Verificar se APK foi gerado
APK_PATH="android/app/build/outputs/apk/debug/app-debug.apk"
if [ -f "$APK_PATH" ]; then
    TIMESTAMP=$(date +%Y%m%d-%H%M%S)
    FINAL_APK="leaf-app-dev-${TIMESTAMP}.apk"
    cp "$APK_PATH" "$FINAL_APK"
    
    echo -e "${GREEN}✅ APK gerado: ${FINAL_APK}${NC}"
    echo ""
    echo -e "${BLUE}📱 Para instalar no dispositivo:${NC}"
    echo -e "   ${GREEN}adb install -r ${FINAL_APK}${NC}"
    echo ""
    
    SIZE=$(du -h "$FINAL_APK" | cut -f1)
    echo -e "${BLUE}📊 Tamanho: ${SIZE}${NC}"
else
    echo -e "${YELLOW}⚠️  APK não encontrado em ${APK_PATH}${NC}"
    echo -e "${YELLOW}   Mas o build pode ter sido instalado diretamente no dispositivo${NC}"
fi

