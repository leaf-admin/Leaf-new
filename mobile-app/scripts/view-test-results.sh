#!/bin/bash

# Script para visualizar resultados de testes Maestro
# Mostra screenshots, logs e estatísticas

set -e

# Cores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}📊 Visualizador de Resultados de Testes${NC}"
echo "======================================"
echo ""

SCREENSHOT_DIR=".maestro/screenshots"

# Listar todos os diretórios de teste
echo -e "${BLUE}📁 Testes disponíveis:${NC}"
echo ""

if [ ! -d "$SCREENSHOT_DIR" ]; then
    echo -e "${YELLOW}⚠️  Nenhum teste executado ainda${NC}"
    exit 0
fi

# Listar diretórios de teste
TEST_DIRS=$(find "$SCREENSHOT_DIR" -type d -name "test_*" | sort -r | head -10)

if [ -z "$TEST_DIRS" ]; then
    echo -e "${YELLOW}⚠️  Nenhum teste encontrado${NC}"
    exit 0
fi

COUNT=1
declare -a DIR_ARRAY

while IFS= read -r dir; do
    DIR_ARRAY+=("$dir")
    TIMESTAMP=$(basename "$dir" | sed 's/test_//')
    SCREENSHOT_COUNT=$(find "$dir" -name "*.png" -o -name "*.jpg" 2>/dev/null | wc -l)
    
    # Verificar se passou ou falhou
    if [ -f "$dir/results.xml" ]; then
        if grep -q "failures=\"0\"" "$dir/results.xml" 2>/dev/null; then
            STATUS="${GREEN}✅ PASSOU${NC}"
        else
            STATUS="${RED}❌ FALHOU${NC}"
        fi
    else
        STATUS="${YELLOW}⏳ EM ANDAMENTO${NC}"
    fi
    
    echo -e "  $COUNT. ${BLUE}$TIMESTAMP${NC} - $STATUS - $SCREENSHOT_COUNT screenshots"
    COUNT=$((COUNT + 1))
done <<< "$TEST_DIRS"

echo ""
read -p "Selecione o número do teste para visualizar (ou Enter para o mais recente): " SELECTION

if [ -z "$SELECTION" ]; then
    SELECTED_DIR="${DIR_ARRAY[0]}"
else
    INDEX=$((SELECTION - 1))
    if [ $INDEX -ge 0 ] && [ $INDEX -lt ${#DIR_ARRAY[@]} ]; then
        SELECTED_DIR="${DIR_ARRAY[$INDEX]}"
    else
        echo -e "${RED}❌ Seleção inválida${NC}"
        exit 1
    fi
fi

echo ""
echo -e "${BLUE}📸 Visualizando: $(basename "$SELECTED_DIR")${NC}"
echo ""

# Mostrar screenshots
SCREENSHOTS=$(find "$SELECTED_DIR" -name "*.png" -o -name "*.jpg" 2>/dev/null | sort)

if [ -z "$SCREENSHOTS" ]; then
    echo -e "${YELLOW}⚠️  Nenhum screenshot encontrado${NC}"
else
    echo -e "${GREEN}📷 Screenshots:${NC}"
    echo "$SCREENSHOTS" | while read -r screenshot; do
        echo "  📷 $(basename "$screenshot")"
    done
    echo ""
    
    # Abrir diretório
    if command -v xdg-open &> /dev/null; then
        xdg-open "$SELECTED_DIR" 2>/dev/null || true
    elif command -v open &> /dev/null; then
        open "$SELECTED_DIR" 2>/dev/null || true
    fi
fi

# Mostrar log
if [ -f "$SELECTED_DIR/test.log" ]; then
    echo -e "${BLUE}📝 Últimas linhas do log:${NC}"
    tail -20 "$SELECTED_DIR/test.log"
    echo ""
fi

# Mostrar resultados XML
if [ -f "$SELECTED_DIR/results.xml" ]; then
    echo -e "${BLUE}📊 Resultados:${NC}"
    grep -E "testsuite|testcase|failure" "$SELECTED_DIR/results.xml" | head -20
    echo ""
fi

echo -e "${GREEN}✅ Visualização completa!${NC}"
echo ""
echo "Para ver todos os arquivos:"
echo "  cd $SELECTED_DIR"
echo "  ls -la"

