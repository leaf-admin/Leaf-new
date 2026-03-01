#!/bin/bash

# 🚀 Script para criar build de release FUNCIONAL
# Gera APK assinado pronto para testes com motorista em outro aparelho
# Inclui todas as novas alterações (modal de cancelamento, etc.)

set -e

# Cores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║     🚀 BUILD DE RELEASE FUNCIONAL - LEAF APP            ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

# Verificar se está no diretório correto
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ Execute este script dentro do diretório mobile-app${NC}"
    exit 1
fi

# Verificar se Android está configurado
if [ ! -d "android" ]; then
    echo -e "${YELLOW}⚠️  Diretório android não encontrado${NC}"
    echo -e "${BLUE}📦 Executando prebuild...${NC}"
    npx expo prebuild --platform android
    echo ""
fi

echo -e "${GREEN}✅ Android nativo configurado${NC}"
echo ""

# Verificar se node_modules está instalado
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}📦 Instalando dependências...${NC}"
    npm install
    echo ""
fi

echo -e "${GREEN}✅ Dependências verificadas${NC}"
echo ""

# Verificar se há mudanças não commitadas (opcional, apenas aviso)
if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
    echo -e "${YELLOW}⚠️  Há mudanças não commitadas no repositório${NC}"
    echo -e "${BLUE}   Continuando mesmo assim...${NC}"
    echo ""
fi

# Limpar builds anteriores
echo -e "${YELLOW}🧹 Limpando builds anteriores...${NC}"
cd android
./gradlew clean > /dev/null 2>&1 || true
cd ..

# Limpar cache do Metro
echo -e "${YELLOW}🧹 Limpando cache do Metro...${NC}"
rm -rf .expo
rm -rf node_modules/.cache
npx expo start --clear > /dev/null 2>&1 &
EXPO_PID=$!
sleep 2
kill $EXPO_PID 2>/dev/null || true

echo -e "${GREEN}✅ Limpeza concluída${NC}"
echo ""

# Verificar se o diretório de assets existe
if [ ! -d "android/app/src/main/assets" ]; then
    echo -e "${YELLOW}📁 Criando diretório de assets...${NC}"
    mkdir -p android/app/src/main/assets
fi

# Gerar bundle JS
echo -e "${YELLOW}📦 Gerando bundle JavaScript...${NC}"
echo -e "${BLUE}   Isso pode levar alguns minutos...${NC}"
npx expo export --platform android --output-dir android/app/src/main/assets/ --clear

# Verificar se bundle foi gerado (pode estar em diferentes formatos)
if [ ! -d "android/app/src/main/assets/_expo" ]; then
    echo -e "${YELLOW}⚠️  Verificando estrutura de assets...${NC}"
    ls -la android/app/src/main/assets/ 2>/dev/null || echo "Diretório assets não existe"
    echo -e "${RED}❌ Erro: Bundle JavaScript não foi gerado corretamente${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Bundle gerado com sucesso${NC}"
echo ""

# Build APK de release
echo -e "${YELLOW}🔨 Compilando APK de release...${NC}"
echo -e "${BLUE}   Isso pode levar 5-10 minutos...${NC}"
echo ""

cd android
./gradlew assembleRelease --no-daemon 2>&1 | tee ../build-release-output.log

echo ""
echo -e "${GREEN}✅ Compilação concluída!${NC}"
echo ""

cd ..

# Verificar se APK foi gerado
APK_PATH="android/app/build/outputs/apk/release/app-release.apk"
if [ -f "$APK_PATH" ]; then
    # Copiar APK para raiz com nome descritivo
    TIMESTAMP=$(date +%Y%m%d-%H%M%S)
    FINAL_APK="leaf-app-release-${TIMESTAMP}.apk"
    cp "$APK_PATH" "$FINAL_APK"
    
    # Obter informações do APK
    SIZE=$(du -h "$FINAL_APK" | cut -f1)
    APK_SIZE_BYTES=$(stat -f%z "$FINAL_APK" 2>/dev/null || stat -c%s "$FINAL_APK" 2>/dev/null || echo "N/A")
    
    echo -e "${CYAN}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║              ✅ BUILD CONCLUÍDA COM SUCESSO!            ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${GREEN}📱 APK gerado:${NC}"
    echo -e "   ${CYAN}$FINAL_APK${NC}"
    echo ""
    echo -e "${BLUE}📊 Informações:${NC}"
    echo -e "   Tamanho: ${SIZE}"
    echo -e "   Timestamp: ${TIMESTAMP}"
    echo ""
    echo -e "${BLUE}📋 Instruções de instalação:${NC}"
    echo ""
    echo -e "${YELLOW}1. Via ADB (recomendado para testes):${NC}"
    echo -e "   ${CYAN}adb install -r $FINAL_APK${NC}"
    echo ""
    echo -e "${YELLOW}2. Via transferência manual:${NC}"
    echo -e "   - Copie o arquivo ${CYAN}$FINAL_APK${NC} para o celular"
    echo -e "   - Abra o arquivo no celular e instale"
    echo -e "   - Permita instalação de fontes desconhecidas se solicitado"
    echo ""
    echo -e "${YELLOW}3. Para instalar em múltiplos dispositivos:${NC}"
    echo -e "   ${CYAN}adb devices${NC}  # Listar dispositivos conectados"
    echo -e "   ${CYAN}adb -s <DEVICE_ID> install -r $FINAL_APK${NC}"
    echo ""
    echo -e "${BLUE}🧪 Testes recomendados:${NC}"
    echo -e "   ✅ Testar modal de cancelamento durante busca"
    echo -e "   ✅ Testar sincronização de eventos entre passageiro e motorista"
    echo -e "   ✅ Testar timer de busca (deve continuar após 'Desejo aguardar')"
    echo -e "   ✅ Testar mensagem de reembolso ao cancelar"
    echo ""
    echo -e "${GREEN}✨ Pronto para testes!${NC}"
    echo ""
else
    echo -e "${RED}❌ Erro: APK não foi gerado${NC}"
    echo -e "${YELLOW}📋 Verifique o log: build-release-output.log${NC}"
    exit 1
fi

