#!/bin/bash

# Script de Verificação do Maestro
# Verifica se tudo está configurado corretamente

set -e

echo "🔍 Verificando Configuração do Maestro"
echo "======================================"
echo ""

# Cores
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ERRORS=0

# Verificar Maestro
echo -e "${BLUE}1. Verificando Maestro...${NC}"
export PATH="$PATH:$HOME/.maestro/bin"
if command -v maestro &> /dev/null; then
    VERSION=$(maestro --version 2>/dev/null | head -1)
    echo -e "${GREEN}✅ Maestro instalado: $VERSION${NC}"
else
    echo -e "${RED}❌ Maestro não encontrado${NC}"
    echo "   Execute: bash scripts/setup-maestro.sh"
    ERRORS=$((ERRORS + 1))
fi

# Verificar estrutura de diretórios
echo -e "${BLUE}2. Verificando estrutura de diretórios...${NC}"
if [ -d ".maestro/flows" ]; then
    echo -e "${GREEN}✅ Diretório .maestro/flows existe${NC}"
else
    echo -e "${RED}❌ Diretório .maestro/flows não encontrado${NC}"
    ERRORS=$((ERRORS + 1))
fi

if [ -d ".maestro/helpers" ]; then
    echo -e "${GREEN}✅ Diretório .maestro/helpers existe${NC}"
else
    echo -e "${RED}❌ Diretório .maestro/helpers não encontrado${NC}"
    ERRORS=$((ERRORS + 1))
fi

# Verificar arquivos de teste
echo -e "${BLUE}3. Verificando arquivos de teste...${NC}"
TEST_FILES=(
    ".maestro/helpers/login.yaml"
    ".maestro/flows/auth/01-login-customer.yaml"
    ".maestro/flows/auth/02-login-driver.yaml"
    ".maestro/flows/rides/01-request-ride.yaml"
)

for file in "${TEST_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo -e "${GREEN}✅ $file${NC}"
    else
        echo -e "${RED}❌ $file não encontrado${NC}"
        ERRORS=$((ERRORS + 1))
    fi
done

# Verificar scripts NPM
echo -e "${BLUE}4. Verificando scripts NPM...${NC}"
if grep -q "test:e2e" package.json; then
    echo -e "${GREEN}✅ Scripts de teste E2E encontrados no package.json${NC}"
else
    echo -e "${YELLOW}⚠️  Scripts de teste E2E não encontrados no package.json${NC}"
fi

# Verificar dispositivos Android
echo -e "${BLUE}5. Verificando dispositivos Android...${NC}"
if command -v adb &> /dev/null; then
    DEVICES=$(adb devices 2>/dev/null | grep -v "List" | grep "device" | wc -l)
    if [ "$DEVICES" -gt 0 ]; then
        echo -e "${GREEN}✅ Dispositivo(s) Android conectado(s)${NC}"
        adb devices | grep -v "List"
    else
        echo -e "${YELLOW}⚠️  Nenhum dispositivo Android conectado${NC}"
        echo "   Conecte um dispositivo ou inicie um emulador"
    fi
else
    echo -e "${YELLOW}⚠️  ADB não encontrado${NC}"
fi

# Verificar app instalado
echo -e "${BLUE}6. Verificando app instalado...${NC}"
if command -v adb &> /dev/null; then
    if adb shell pm list packages 2>/dev/null | grep -q "br.com.leaf.ride"; then
        echo -e "${GREEN}✅ App Leaf instalado${NC}"
    else
        echo -e "${YELLOW}⚠️  App Leaf não encontrado no dispositivo${NC}"
        echo "   Execute: npm run android"
    fi
fi

echo ""
if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN}✅ Tudo configurado corretamente!${NC}"
    echo ""
    echo "📚 Próximos passos:"
    echo "   1. Build do app: npm run android"
    echo "   2. Executar testes: npm run test:e2e"
    exit 0
else
    echo -e "${RED}❌ Encontrados $ERRORS erro(s)${NC}"
    echo ""
    echo "🔧 Execute: bash scripts/setup-maestro.sh"
    exit 1
fi













