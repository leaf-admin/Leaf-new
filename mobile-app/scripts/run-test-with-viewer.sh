#!/bin/bash

# Script para executar testes Maestro com visualização de telas
# Mostra screenshots e logs em tempo real

set -e

# Cores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}🎭 Executando Teste Maestro com Visualização${NC}"
echo "=========================================="
echo ""

# Verificar se foi passado um teste
if [ -z "$1" ]; then
    echo -e "${RED}❌ Uso: $0 <caminho-do-teste.yaml>${NC}"
    echo ""
    echo "Exemplos:"
    echo "  $0 .maestro/flows/auth/01-login-customer-real.yaml"
    echo "  $0 .maestro/flows/rides/01-request-ride-real.yaml"
    exit 1
fi

TEST_FILE="$1"

# Verificar se arquivo existe
if [ ! -f "$TEST_FILE" ]; then
    echo -e "${RED}❌ Arquivo não encontrado: $TEST_FILE${NC}"
    exit 1
fi

# Criar diretório de screenshots com timestamp
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
SCREENSHOT_DIR=".maestro/screenshots/test_${TIMESTAMP}"
mkdir -p "$SCREENSHOT_DIR"

echo -e "${BLUE}📁 Screenshots serão salvos em: $SCREENSHOT_DIR${NC}"
echo ""

# Exportar PATH do Maestro
export PATH="$PATH:$HOME/.maestro/bin"

# Executar teste com screenshots
echo -e "${GREEN}▶️  Executando teste: $TEST_FILE${NC}"
echo ""

maestro test "$TEST_FILE" --format junit --output "$SCREENSHOT_DIR/results.xml" 2>&1 | tee "$SCREENSHOT_DIR/test.log"

# Verificar resultado
if [ ${PIPESTATUS[0]} -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✅ Teste passou!${NC}"
else
    echo ""
    echo -e "${RED}❌ Teste falhou!${NC}"
fi

# Listar screenshots
echo ""
echo -e "${BLUE}📸 Screenshots capturados:${NC}"
SCREENSHOTS=$(find "$SCREENSHOT_DIR" -name "*.png" -o -name "*.jpg" 2>/dev/null | sort)
if [ -z "$SCREENSHOTS" ]; then
    echo "  Nenhum screenshot encontrado"
else
    echo "$SCREENSHOTS" | while read -r screenshot; do
        echo "  📷 $(basename "$screenshot")"
    done
fi

# Abrir diretório de screenshots (se possível)
if command -v xdg-open &> /dev/null; then
    echo ""
    echo -e "${YELLOW}💡 Abrindo diretório de screenshots...${NC}"
    xdg-open "$SCREENSHOT_DIR" 2>/dev/null || true
elif command -v open &> /dev/null; then
    echo ""
    echo -e "${YELLOW}💡 Abrindo diretório de screenshots...${NC}"
    open "$SCREENSHOT_DIR" 2>/dev/null || true
fi

echo ""
echo -e "${BLUE}📊 Para ver os screenshots:${NC}"
echo "  cd $SCREENSHOT_DIR"
echo "  ls -la"













