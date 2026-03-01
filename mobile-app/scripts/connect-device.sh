#!/bin/bash

# Script para conectar e configurar dispositivo físico para testes Maestro
# Verifica conexão, instala app se necessário e configura tudo

set -e

# Cores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}📱 Configurando Dispositivo Físico para Testes Maestro${NC}"
echo "=================================================="
echo ""

# Verificar se ADB está disponível
if ! command -v adb &> /dev/null; then
    echo -e "${RED}❌ ADB não encontrado${NC}"
    echo "   Instale Android SDK Platform Tools"
    exit 1
fi

# Verificar dispositivos conectados
echo -e "${BLUE}🔍 Verificando dispositivos conectados...${NC}"
DEVICES=$(adb devices | grep -v "List" | grep "device" | grep -v "^$")

if [ -z "$DEVICES" ]; then
    echo -e "${RED}❌ Nenhum dispositivo encontrado${NC}"
    echo ""
    echo "Verifique:"
    echo "  1. Dispositivo está conectado via USB"
    echo "  2. Depuração USB está habilitada:"
    echo "     Configurações > Sobre o telefone > Toque 7x em 'Número da versão'"
    echo "     Configurações > Opções do desenvolvedor > Depuração USB (ativar)"
    echo "  3. Autorizou o computador no dispositivo (aparece popup)"
    echo ""
    exit 1
fi

echo -e "${GREEN}✅ Dispositivo(s) encontrado(s):${NC}"
adb devices | grep -v "List"
echo ""

# Obter informações do dispositivo
DEVICE_SERIAL=$(adb devices | grep "device" | grep -v "List" | head -1 | awk '{print $1}')
MODEL=$(adb shell getprop ro.product.model 2>/dev/null || echo "Desconhecido")
VERSION=$(adb shell getprop ro.build.version.release 2>/dev/null || echo "Desconhecido")
BRAND=$(adb shell getprop ro.product.brand 2>/dev/null || echo "Desconhecido")

echo -e "${BLUE}📱 Informações do Dispositivo:${NC}"
echo "  Modelo: $MODEL"
echo "  Marca: $BRAND"
echo "  Android: $VERSION"
echo "  Serial: $DEVICE_SERIAL"
echo ""

# Verificar se app está instalado
echo -e "${BLUE}🔍 Verificando se app Leaf está instalado...${NC}"
APP_INSTALLED=$(adb shell pm list packages | grep "br.com.leaf.ride" || echo "")

if [ -z "$APP_INSTALLED" ]; then
    echo -e "${YELLOW}⚠️  App Leaf não encontrado no dispositivo${NC}"
    echo ""
    read -p "Deseja instalar o app agora? (s/n): " INSTALL_APP
    
    if [ "$INSTALL_APP" = "s" ] || [ "$INSTALL_APP" = "S" ]; then
        echo -e "${BLUE}📦 Construindo e instalando app...${NC}"
        npm run android
        
        # Verificar se instalou
        sleep 3
        APP_INSTALLED=$(adb shell pm list packages | grep "br.com.leaf.ride" || echo "")
        if [ -z "$APP_INSTALLED" ]; then
            echo -e "${RED}❌ Falha ao instalar app${NC}"
            exit 1
        fi
    else
        echo -e "${YELLOW}⚠️  App não instalado. Execute 'npm run android' depois${NC}"
    fi
else
    echo -e "${GREEN}✅ App Leaf instalado${NC}"
fi

# Verificar permissões necessárias
echo ""
echo -e "${BLUE}🔐 Verificando permissões...${NC}"

# Verificar se depuração USB está ativa
USB_DEBUG=$(adb shell settings get global adb_enabled 2>/dev/null || echo "1")
if [ "$USB_DEBUG" != "1" ]; then
    echo -e "${YELLOW}⚠️  Depuração USB pode não estar totalmente habilitada${NC}"
fi

# Verificar se pode acessar tela
SCREEN_ON=$(adb shell dumpsys power | grep "mScreenOn=true" || echo "")
if [ -z "$SCREEN_ON" ]; then
    echo -e "${YELLOW}💡 Desbloqueie a tela do dispositivo${NC}"
    read -p "Pressione Enter quando a tela estiver desbloqueada..."
fi

# Testar conexão
echo ""
echo -e "${BLUE}🧪 Testando conexão...${NC}"
if adb shell echo "test" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Conexão funcionando!${NC}"
else
    echo -e "${RED}❌ Erro na conexão${NC}"
    exit 1
fi

# Configurar para usar dispositivo físico
echo ""
echo -e "${BLUE}⚙️  Configurando Maestro para usar dispositivo físico...${NC}"

# Criar arquivo de configuração do dispositivo
DEVICE_CONFIG=".maestro/device-config.yaml"
mkdir -p .maestro

cat > "$DEVICE_CONFIG" << EOF
# Configuração do Dispositivo Físico
device:
  type: android
  serial: $DEVICE_SERIAL

appId: br.com.leaf.ride
EOF

echo -e "${GREEN}✅ Configuração salva em: $DEVICE_CONFIG${NC}"

# Verificar se scrcpy está disponível (para ver tela no PC)
echo ""
if command -v scrcpy &> /dev/null; then
    echo -e "${GREEN}✅ scrcpy instalado - Você pode ver a tela no computador!${NC}"
    echo ""
    read -p "Deseja abrir scrcpy para ver a tela do dispositivo? (s/n): " OPEN_SCRCPY
    
    if [ "$OPEN_SCRCPY" = "s" ] || [ "$OPEN_SCRCPY" = "S" ]; then
        echo -e "${BLUE}📺 Abrindo scrcpy...${NC}"
        scrcpy &
        echo -e "${GREEN}✅ scrcpy iniciado! Você verá a tela do dispositivo${NC}"
    fi
else
    echo -e "${YELLOW}💡 Dica: Instale scrcpy para ver a tela do dispositivo no PC:${NC}"
    echo "   sudo apt install scrcpy  # Linux"
    echo "   brew install scrcpy      # macOS"
fi

echo ""
echo -e "${GREEN}✅ Dispositivo físico configurado!${NC}"
echo ""
echo -e "${BLUE}📝 Próximos passos:${NC}"
echo "  1. Desbloqueie a tela do dispositivo"
echo "  2. Execute o teste:"
echo "     npm run test:e2e:live .maestro/flows/auth/01-login-customer-real.yaml"
echo ""
echo -e "${YELLOW}💡 Dica: Você pode ver a tela do dispositivo:${NC}"
echo "  - Diretamente no celular (recomendado)"
echo "  - Via scrcpy (se instalado): scrcpy"
echo "  - Via Android Studio: Tools > Device Manager"













