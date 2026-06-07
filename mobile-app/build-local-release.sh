#!/bin/bash

# 🚀 Script para criar build de release LOCAL (mais rápido)
# Gera APK que pode ser instalado diretamente nos celulares

set -e

# Cores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Criando build de release LOCAL${NC}"
echo ""

# Verificar se está no diretório correto
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ Execute este script dentro do diretório mobile-app${NC}"
    exit 1
fi

# Verificar se Android está configurado
if [ ! -d "android" ]; then
    echo -e "${RED}❌ Diretório android não encontrado${NC}"
    echo "   Execute: npx expo prebuild"
    exit 1
fi

echo -e "${GREEN}✅ Android nativo configurado${NC}"
echo ""

if [ -z "$JAVA_HOME" ] && [ -x "/opt/homebrew/opt/openjdk@17/bin/java" ]; then
    export JAVA_HOME="/opt/homebrew/opt/openjdk@17"
fi

if [ -n "$JAVA_HOME" ]; then
    export PATH="$JAVA_HOME/bin:$PATH"
fi

if [ -f ".env.production.local" ]; then
    set -a
    # shellcheck disable=SC1091
    source ".env.production.local"
    set +a
fi

if [ -n "$LEAF_UPLOAD_STORE_FILE" ] && [ "${LEAF_UPLOAD_STORE_FILE#/}" = "$LEAF_UPLOAD_STORE_FILE" ]; then
    if [ -f "$LEAF_UPLOAD_STORE_FILE" ]; then
        export LEAF_UPLOAD_STORE_FILE="$(pwd)/$LEAF_UPLOAD_STORE_FILE"
    elif [ -f "android/app/$LEAF_UPLOAD_STORE_FILE" ]; then
        export LEAF_UPLOAD_STORE_FILE="$(pwd)/android/app/$LEAF_UPLOAD_STORE_FILE"
    fi
fi

if ! command -v java >/dev/null 2>&1; then
    echo -e "${RED}❌ Java não encontrado. Instale/aponte JDK 17 em JAVA_HOME.${NC}"
    exit 1
fi

# Verificar se node_modules está instalado
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}📦 Instalando dependências...${NC}"
    npm install
fi

echo -e "${GREEN}✅ Dependências verificadas${NC}"
echo ""

# Limpar builds anteriores
echo -e "${YELLOW}🧹 Limpando builds anteriores...${NC}"
cd android
./gradlew clean
cd ..

echo -e "${GREEN}✅ Limpeza concluída${NC}"
echo ""

# Gerar bundle JS
echo -e "${YELLOW}📦 Gerando bundle JavaScript...${NC}"
npx expo export --platform android --output-dir android/app/src/main/assets/

echo -e "${GREEN}✅ Bundle gerado${NC}"
echo ""

# Build APK de release
echo -e "${YELLOW}🔨 Compilando APK de release...${NC}"
cd android
./gradlew assembleRelease

echo ""
echo -e "${GREEN}✅ Build concluída!${NC}"
echo ""

# Verificar se APK foi gerado
APK_PATH="app/build/outputs/apk/release/app-release.apk"
if [ -f "$APK_PATH" ]; then
    # Copiar APK para raiz com nome descritivo
    TIMESTAMP=$(date +%Y%m%d-%H%M%S)
    FINAL_APK="../leaf-app-release-${TIMESTAMP}.apk"
    cp "$APK_PATH" "$FINAL_APK"
    
    echo -e "${GREEN}✅ APK gerado com sucesso!${NC}"
    echo ""
    echo -e "${BLUE}📱 APK disponível em:${NC}"
    echo -e "   ${GREEN}$FINAL_APK${NC}"
    echo ""
    echo -e "${BLUE}📋 Para instalar no celular:${NC}"
    echo -e "   ${YELLOW}1. Via ADB:${NC}"
    echo -e "      adb install -r $FINAL_APK"
    echo ""
    echo -e "   ${YELLOW}2. Manualmente:${NC}"
    echo -e "      Copie o arquivo para o celular e instale"
    echo ""
    
    # Mostrar tamanho do arquivo
    SIZE=$(du -h "$FINAL_APK" | cut -f1)
    echo -e "${BLUE}📊 Tamanho: ${SIZE}${NC}"
    echo ""
else
    echo -e "${RED}❌ Erro: APK não foi gerado${NC}"
    echo "   Verifique os logs acima para erros"
    exit 1
fi

cd ..

