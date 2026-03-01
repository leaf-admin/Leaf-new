#!/bin/bash

# Script para configurar e iniciar emulador Android
# Para ver os testes Maestro em tempo real

set -e

# Cores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}📱 Configurando Emulador Android para Testes Maestro${NC}"
echo "=================================================="
echo ""

# Verificar se ANDROID_HOME está configurado
if [ -z "$ANDROID_HOME" ]; then
    if [ -d "$HOME/Android/Sdk" ]; then
        export ANDROID_HOME="$HOME/Android/Sdk"
        export PATH="$PATH:$ANDROID_HOME/emulator:$ANDROID_HOME/tools:$ANDROID_HOME/platform-tools"
        echo -e "${GREEN}✅ ANDROID_HOME configurado: $ANDROID_HOME${NC}"
    else
        echo -e "${RED}❌ ANDROID_HOME não configurado${NC}"
        echo "   Configure no ~/.bashrc ou ~/.zshrc:"
        echo "   export ANDROID_HOME=\$HOME/Android/Sdk"
        echo "   export PATH=\$PATH:\$ANDROID_HOME/emulator:\$ANDROID_HOME/tools:\$ANDROID_HOME/platform-tools"
        exit 1
    fi
fi

# Verificar se emulator está disponível
if ! command -v emulator &> /dev/null; then
    echo -e "${RED}❌ Emulador não encontrado${NC}"
    echo "   Instale via Android Studio:"
    echo "   Tools > SDK Manager > SDK Tools > Android Emulator"
    exit 1
fi

# Listar emuladores disponíveis
echo -e "${BLUE}📋 Emuladores disponíveis:${NC}"
AVDS=$(emulator -list-avds 2>/dev/null)

if [ -z "$AVDS" ]; then
    echo -e "${YELLOW}⚠️  Nenhum emulador encontrado${NC}"
    echo ""
    echo "Crie um emulador via Android Studio:"
    echo "  1. Tools > Device Manager"
    echo "  2. Create Device"
    echo "  3. Escolha um dispositivo (ex: Pixel 5)"
    echo "  4. Escolha versão Android (ex: API 33)"
    echo "  5. Finish"
    exit 1
fi

echo "$AVDS" | nl -w2 -s'. '
echo ""

# Selecionar emulador
read -p "Digite o número do emulador para iniciar (ou Enter para o primeiro): " SELECTION

if [ -z "$SELECTION" ]; then
    SELECTED_AVD=$(echo "$AVDS" | head -1)
else
    SELECTED_AVD=$(echo "$AVDS" | sed -n "${SELECTION}p")
fi

if [ -z "$SELECTED_AVD" ]; then
    echo -e "${RED}❌ Seleção inválida${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}🚀 Iniciando emulador: $SELECTED_AVD${NC}"
echo -e "${YELLOW}💡 Isso pode levar 30-60 segundos...${NC}"
echo ""

# Iniciar emulador em background
emulator -avd "$SELECTED_AVD" > /dev/null 2>&1 &

EMULATOR_PID=$!

echo -e "${BLUE}⏳ Aguardando emulador iniciar...${NC}"

# Aguardar emulador estar pronto
TIMEOUT=120
ELAPSED=0
while [ $ELAPSED -lt $TIMEOUT ]; do
    if adb devices 2>/dev/null | grep -q "emulator.*device"; then
        echo -e "${GREEN}✅ Emulador iniciado!${NC}"
        break
    fi
    sleep 2
    ELAPSED=$((ELAPSED + 2))
    echo -n "."
done

echo ""

if [ $ELAPSED -ge $TIMEOUT ]; then
    echo -e "${RED}❌ Timeout aguardando emulador${NC}"
    kill $EMULATOR_PID 2>/dev/null || true
    exit 1
fi

# Verificar dispositivo
echo -e "${BLUE}📱 Dispositivos conectados:${NC}"
adb devices

echo ""
echo -e "${GREEN}✅ Emulador pronto!${NC}"
echo ""
echo -e "${BLUE}📝 Próximos passos:${NC}"
echo "  1. Você verá a janela do emulador com a tela do Android"
echo "  2. Execute o teste em outro terminal:"
echo "     cd mobile-app"
echo "     bash scripts/run-test-with-viewer.sh .maestro/flows/auth/01-login-customer-real.yaml"
echo ""
echo -e "${YELLOW}💡 Para parar o emulador:${NC}"
echo "  adb emu kill"
echo "  ou feche a janela do emulador"













