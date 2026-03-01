#!/bin/bash

# 🚀 Script para criar build de desenvolvimento LOCAL com APP_REVIEW=true
# Gera APK de debug com bypass do OTP para usuários de teste/revisão

set -e

# Cores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Criando build de desenvolvimento LOCAL com APP_REVIEW${NC}"
echo -e "${YELLOW}📋 Flag APP_REVIEW=true ativada (bypass OTP para teste/revisão)${NC}"
echo ""

# Verificar se está no diretório correto
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ Execute este script dentro do diretório mobile-app${NC}"
    exit 1
fi

# Verificar se Android está configurado
if [ ! -d "android" ]; then
    echo -e "${YELLOW}📦 Configurando projeto Android nativo...${NC}"
    npx expo prebuild --platform android
fi

echo -e "${GREEN}✅ Android nativo configurado${NC}"
echo ""

# Verificar se node_modules está instalado
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}📦 Instalando dependências...${NC}"
    npm install
fi

echo -e "${GREEN}✅ Dependências verificadas${NC}"
echo ""

# Configurar variável de ambiente APP_REVIEW
echo -e "${YELLOW}🔧 Configurando APP_REVIEW=true...${NC}"
export APP_REVIEW=true
export EXPO_PUBLIC_APP_REVIEW=true
echo -e "${GREEN}✅ APP_REVIEW configurado${NC}"
echo ""

# Limpar builds anteriores
echo -e "${YELLOW}🧹 Limpando builds anteriores...${NC}"
cd android
./gradlew clean
cd ..

echo -e "${GREEN}✅ Limpeza concluída${NC}"
echo ""

# Build APK de debug
echo -e "${YELLOW}🔨 Compilando APK de desenvolvimento...${NC}"
echo -e "${BLUE}   APP_REVIEW=true (bypass OTP ativado)${NC}"
cd android
./gradlew assembleDebug

echo ""
echo -e "${GREEN}✅ Build concluída!${NC}"
echo ""

# Verificar se APK foi gerado
APK_PATH="app/build/outputs/apk/debug/app-debug.apk"
if [ -f "$APK_PATH" ]; then
    # Copiar APK para raiz com nome descritivo
    TIMESTAMP=$(date +%Y%m%d-%H%M%S)
    FINAL_APK="../leaf-app-dev-review-${TIMESTAMP}.apk"
    cp "$APK_PATH" "$FINAL_APK"

    echo -e "${GREEN}✅ APK gerado com sucesso!${NC}"
    echo ""

    # Mostrar informações do APK
    SIZE=$(du -h "$FINAL_APK" | cut -f1)
    echo -e "${BLUE}📱 APK disponível em:${NC}"
    echo -e "   ${GREEN}$FINAL_APK${NC}"
    echo ""
    echo -e "${BLUE}📊 Tamanho: ${SIZE}${NC}"
    echo ""
    echo -e "${GREEN}🎯 Flag APP_REVIEW: ATIVADA${NC}"
    echo -e "${BLUE}   Bypass OTP habilitado para usuários de teste/revisão${NC}"
    echo ""

    # Instalar no dispositivo conectado
    echo -e "${YELLOW}📲 Instalando no dispositivo conectado...${NC}"
    if adb devices | grep -q "device$"; then
        adb install -r "$FINAL_APK"
        echo -e "${GREEN}✅ Instalação concluída!${NC}"
    else
        echo -e "${RED}❌ Nenhum dispositivo conectado${NC}"
        echo -e "${YELLOW}📋 Para instalar manualmente:${NC}"
        echo -e "   adb install -r $FINAL_APK"
    fi
    echo ""

else
    echo -e "${RED}❌ Erro: APK não foi gerado${NC}"
    echo "   Verifique os logs acima para erros"
    exit 1
fi

cd ..

echo ""
echo -e "${GREEN}🎉 Build de desenvolvimento com APP_REVIEW concluída!${NC}"
echo -e "${BLUE}📱 APK pronto para testes de revisão${NC}"
