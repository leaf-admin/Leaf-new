#!/bin/bash

# Script para executar teste Maestro no dispositivo físico
# Mostra como ver a tela em tempo real

set -e

# Cores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}📱 Executando Teste no Dispositivo Físico${NC}"
echo "======================================"
echo ""

# Verificar dispositivo
DEVICES=$(adb devices | grep -v "List" | grep "device" | grep -v "^$")

if [ -z "$DEVICES" ]; then
    echo -e "${RED}❌ Nenhum dispositivo encontrado${NC}"
    echo "   Conecte o dispositivo via USB e habilite Depuração USB"
    exit 1
fi

DEVICE_SERIAL=$(adb devices | grep "device" | grep -v "List" | head -1 | awk '{print $1}')
MODEL=$(adb shell getprop ro.product.model 2>/dev/null || echo "Desconhecido")

echo -e "${GREEN}✅ Dispositivo conectado: $MODEL ($DEVICE_SERIAL)${NC}"
echo ""

# Verificar se app está instalado
APP_INSTALLED=$(adb shell pm list packages | grep "br.com.leaf.ride" || echo "")

if [ -z "$APP_INSTALLED" ]; then
    echo -e "${YELLOW}⚠️  App não instalado. Instalando...${NC}"
    npm run android
    sleep 3
fi

# Verificar se foi passado um teste
if [ -z "$1" ]; then
    echo -e "${RED}❌ Uso: $0 <caminho-do-teste.yaml>${NC}"
    echo ""
    echo "Exemplo:"
    echo "  $0 .maestro/flows/auth/01-login-customer-real.yaml"
    exit 1
fi

TEST_FILE="$1"

if [ ! -f "$TEST_FILE" ]; then
    echo -e "${RED}❌ Arquivo não encontrado: $TEST_FILE${NC}"
    exit 1
fi

# Configurar screenshots
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
SCREENSHOT_DIR=".maestro/screenshots/test_${TIMESTAMP}"
mkdir -p "$SCREENSHOT_DIR"

echo -e "${BLUE}📸 Screenshots serão salvos em: $SCREENSHOT_DIR${NC}"
echo ""

# Verificar se scrcpy está disponível
if command -v scrcpy &> /dev/null; then
    echo -e "${GREEN}✅ scrcpy disponível - Você pode ver a tela no PC!${NC}"
    echo ""
    read -p "Deseja abrir scrcpy para ver a tela do dispositivo? (s/n): " OPEN_SCRCPY
    
    if [ "$OPEN_SCRCPY" = "s" ] || [ "$OPEN_SCRCPY" = "S" ]; then
        echo -e "${BLUE}📺 Iniciando scrcpy...${NC}"
        scrcpy &
        SCRCPY_PID=$!
        sleep 2
        echo -e "${GREEN}✅ scrcpy iniciado! Você verá a tela do dispositivo na janela${NC}"
        echo ""
    fi
else
    echo -e "${YELLOW}💡 Dica: Instale scrcpy para ver a tela no PC:${NC}"
    echo "   sudo apt install scrcpy"
    echo ""
    echo -e "${BLUE}👀 Você pode ver a tela diretamente no seu celular!${NC}"
    echo ""
fi

# Instruções
echo -e "${BLUE}📋 Instruções:${NC}"
echo "  1. Desbloqueie a tela do dispositivo"
echo "  2. Mantenha a tela ligada durante o teste"
echo "  3. Observe o dispositivo (ou janela scrcpy) para ver as ações"
echo ""
read -p "Pressione Enter quando estiver pronto..."

# Exportar PATH do Maestro
export PATH="$PATH:$HOME/.maestro/bin"

# Configurar dispositivo via variável de ambiente
export ANDROID_SERIAL="$DEVICE_SERIAL"

# Executar teste no dispositivo específico
echo ""
echo -e "${GREEN}▶️  Executando teste no dispositivo físico...${NC}"
echo -e "${YELLOW}👀 Observe o dispositivo para ver cada ação!${NC}"
echo -e "${BLUE}📱 Usando dispositivo: $DEVICE_SERIAL${NC}"
echo ""

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
fi

# Abrir pasta de screenshots
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

