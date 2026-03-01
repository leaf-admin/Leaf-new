#!/bin/bash

# Script para executar teste Maestro e ver em tempo real
# Inicia emulador se necessário e mostra tudo acontecendo

set -e

# Cores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}🎬 Executando Teste Maestro em Tempo Real${NC}"
echo "=========================================="
echo ""

# Verificar se foi passado um teste
if [ -z "$1" ]; then
    echo -e "${RED}❌ Uso: $0 <caminho-do-teste.yaml>${NC}"
    echo ""
    echo "Exemplos:"
    echo "  $0 .maestro/flows/auth/01-login-customer-real.yaml"
    exit 1
fi

TEST_FILE="$1"

# Verificar se arquivo existe
if [ ! -f "$TEST_FILE" ]; then
    echo -e "${RED}❌ Arquivo não encontrado: $TEST_FILE${NC}"
    exit 1
fi

# Verificar se há dispositivo conectado
echo -e "${BLUE}📱 Verificando dispositivos...${NC}"
DEVICES=$(adb devices 2>/dev/null | grep -v "List" | grep "device" | wc -l)

if [ "$DEVICES" -eq 0 ]; then
    echo -e "${YELLOW}⚠️  Nenhum dispositivo encontrado${NC}"
    echo ""
    echo "Opções:"
    echo "  1. Iniciar emulador: bash scripts/setup-emulator.sh"
    echo "  2. Conectar dispositivo físico via USB"
    echo ""
    read -p "Deseja iniciar um emulador agora? (s/n): " START_EMU
    
    if [ "$START_EMU" = "s" ] || [ "$START_EMU" = "S" ]; then
        bash scripts/setup-emulator.sh
        sleep 5
    else
        echo -e "${RED}❌ É necessário um dispositivo ou emulador para executar testes${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}✅ Dispositivo(s) encontrado(s)${NC}"
    adb devices | grep -v "List"
fi

echo ""
echo -e "${BLUE}📸 Configurando screenshots...${NC}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
SCREENSHOT_DIR=".maestro/screenshots/test_${TIMESTAMP}"
mkdir -p "$SCREENSHOT_DIR"

echo -e "${GREEN}✅ Screenshots serão salvos em: $SCREENSHOT_DIR${NC}"
echo ""

# Exportar PATH do Maestro
export PATH="$PATH:$HOME/.maestro/bin"

echo -e "${BLUE}🎭 IMPORTANTE:${NC}"
echo "  - O emulador/dispositivo deve estar VISÍVEL"
echo "  - Você verá cada ação acontecendo em tempo real"
echo "  - Screenshots serão capturados automaticamente"
echo ""
read -p "Pressione Enter para iniciar o teste..."

echo ""
echo -e "${GREEN}▶️  Executando teste: $TEST_FILE${NC}"
echo -e "${YELLOW}👀 Observe o emulador/dispositivo para ver as ações!${NC}"
echo ""

# Executar teste
maestro test "$TEST_FILE" --format junit --output "$SCREENSHOT_DIR/results.xml" 2>&1 | tee "$SCREENSHOT_DIR/test.log"

# Verificar resultado
if [ ${PIPESTATUS[0]} -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✅ Teste passou!${NC}"
else
    echo ""
    echo -e "${RED}❌ Teste falhou!${NC}"
    echo -e "${YELLOW}💡 Veja os logs em: $SCREENSHOT_DIR/test.log${NC}"
fi

# Listar screenshots
echo ""
echo -e "${BLUE}📸 Screenshots capturados:${NC}"
SCREENSHOTS=$(find "$SCREENSHOT_DIR" -name "*.png" -o -name "*.jpg" 2>/dev/null | sort)
if [ -z "$SCREENSHOTS" ]; then
    echo "  Nenhum screenshot encontrado"
else
    COUNT=$(echo "$SCREENSHOTS" | wc -l)
    echo -e "${GREEN}✅ $COUNT screenshots capturados${NC}"
    echo ""
    echo "Primeiros screenshots:"
    echo "$SCREENSHOTS" | head -5 | while read -r screenshot; do
        echo "  📷 $(basename "$screenshot")"
    done
fi

# Abrir diretório de screenshots
if command -v xdg-open &> /dev/null; then
    echo ""
    echo -e "${YELLOW}💡 Abrindo pasta de screenshots...${NC}"
    xdg-open "$SCREENSHOT_DIR" 2>/dev/null || true
elif command -v open &> /dev/null; then
    echo ""
    echo -e "${YELLOW}💡 Abrindo pasta de screenshots...${NC}"
    open "$SCREENSHOT_DIR" 2>/dev/null || true
fi

echo ""
echo -e "${BLUE}📊 Para ver todos os screenshots:${NC}"
echo "  cd $SCREENSHOT_DIR"
echo "  ls -la"













