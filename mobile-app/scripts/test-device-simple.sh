#!/bin/bash

# Script simplificado para testar no dispositivo físico
# Usa ANDROID_SERIAL para especificar dispositivo

set -e

# Cores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}📱 Teste Maestro no Dispositivo Físico${NC}"
echo "================================"
echo ""

# Verificar dispositivo
DEVICES=$(adb devices | grep -v "List" | grep "device" | grep -v "^$")

if [ -z "$DEVICES" ]; then
    echo -e "${RED}❌ Nenhum dispositivo encontrado${NC}"
    exit 1
fi

# Se houver múltiplos dispositivos, usar o primeiro
DEVICE_SERIAL=$(adb devices | grep "device" | grep -v "List" | head -1 | awk '{print $1}')

echo -e "${GREEN}✅ Dispositivo: $DEVICE_SERIAL${NC}"
echo ""

# Verificar se foi passado um teste
if [ -z "$1" ]; then
    echo -e "${RED}❌ Uso: $0 <caminho-do-teste.yaml>${NC}"
    exit 1
fi

TEST_FILE="$1"

if [ ! -f "$TEST_FILE" ]; then
    echo -e "${RED}❌ Arquivo não encontrado: $TEST_FILE${NC}"
    exit 1
fi

# Configurar dispositivo via variável de ambiente
export ANDROID_SERIAL="$DEVICE_SERIAL"
export PATH="$PATH:$HOME/.maestro/bin"

echo -e "${BLUE}▶️  Executando teste...${NC}"
echo -e "${YELLOW}👀 Observe o celular para ver cada ação!${NC}"
echo ""

# Executar teste
maestro test "$TEST_FILE"

echo ""
echo -e "${GREEN}✅ Teste concluído!${NC}"













