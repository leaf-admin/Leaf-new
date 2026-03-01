#!/bin/bash

# 🔧 Script para corrigir problemas de build e gerar APK de release

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}🔧 Corrigindo problemas de build...${NC}"
echo ""

cd "$(dirname "$0")"

# Limpar todos os caches
echo -e "${YELLOW}🧹 Limpando caches...${NC}"
rm -rf android/.gradle/kotlin
rm -rf android/.gradle/caches
rm -rf android/.gradle/buildOutputCleanup
rm -rf android/app/build
rm -rf .expo
rm -rf node_modules/.cache

echo -e "${GREEN}✅ Caches limpos${NC}"
echo ""

# Limpar build do Android
echo -e "${YELLOW}🧹 Limpando build Android...${NC}"
cd android
./gradlew clean --no-daemon
cd ..

echo -e "${GREEN}✅ Build limpo${NC}"
echo ""

# Gerar bundle
echo -e "${YELLOW}📦 Gerando bundle JavaScript...${NC}"
npx expo export --platform android --output-dir android/app/src/main/assets/ --clear

echo -e "${GREEN}✅ Bundle gerado${NC}"
echo ""

# Build APK
echo -e "${YELLOW}🔨 Compilando APK de release...${NC}"
cd android
./gradlew assembleRelease --no-daemon --no-build-cache 2>&1 | tee ../build-release-fixed.log

cd ..

# Verificar APK
APK_PATH="android/app/build/outputs/apk/release/app-release.apk"
if [ -f "$APK_PATH" ]; then
    TIMESTAMP=$(date +%Y%m%d-%H%M%S)
    FINAL_APK="leaf-app-release-${TIMESTAMP}.apk"
    cp "$APK_PATH" "$FINAL_APK"
    
    SIZE=$(du -h "$FINAL_APK" | cut -f1)
    
    echo ""
    echo -e "${GREEN}✅ Build concluída com sucesso!${NC}"
    echo -e "${BLUE}📱 APK: ${FINAL_APK} (${SIZE})${NC}"
    echo ""
    echo -e "${YELLOW}Para instalar:${NC}"
    echo -e "  adb install -r ${FINAL_APK}"
else
    echo -e "${RED}❌ Build falhou. Verifique build-release-fixed.log${NC}"
    exit 1
fi


