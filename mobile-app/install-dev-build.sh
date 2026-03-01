#!/bin/bash

# 📱 Instalar Build de Desenvolvimento no Dispositivo Conectado
# Detecta automaticamente se usar build EAS ou local

set -e

cd "$(dirname "$0")"

# Cores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}📱 INSTALAÇÃO DE BUILD DE DESENVOLVIMENTO${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Verificar ADB
if ! command -v adb &> /dev/null; then
    echo -e "${RED}❌ ADB não encontrado${NC}"
    echo "Instale o Android SDK e configure o PATH"
    exit 1
fi

# Verificar dispositivos conectados
echo -e "${YELLOW}🔍 Verificando dispositivos...${NC}"
DEVICES=$(adb devices | grep "device$" | wc -l)

if [ $DEVICES -eq 0 ]; then
    echo -e "${RED}❌ Nenhum dispositivo conectado${NC}"
    echo ""
    echo "📋 Instruções:"
    echo "1. Conecte o dispositivo via USB"
    echo "2. Habilite 'Depuração USB' nas opções do desenvolvedor"
    echo "3. Execute: adb devices"
    exit 1
fi

echo -e "${GREEN}✅ $DEVICES dispositivo(s) conectado(s)${NC}"
adb devices | grep "device$"
echo ""

# Função para instalar APK
install_apk() {
    local apk_file=$1
    if [ ! -f "$apk_file" ]; then
        echo -e "${RED}❌ APK não encontrado: $apk_file${NC}"
        return 1
    fi
    
    echo -e "${YELLOW}📦 Instalando: $apk_file${NC}"
    
    # Desinstalar versão anterior
    echo -e "${YELLOW}🧹 Removendo versão anterior...${NC}"
    adb uninstall br.com.leaf.ride 2>/dev/null || echo "   (App não estava instalado)"
    
    # Instalar novo APK
    echo -e "${YELLOW}📲 Instalando novo APK...${NC}"
    if adb install -r "$apk_file"; then
        echo -e "${GREEN}✅ Instalação concluída!${NC}"
        return 0
    else
        echo -e "${RED}❌ Falha na instalação${NC}"
        return 1
    fi
}

# Opção 1: Tentar baixar build EAS mais recente
echo -e "${BLUE}📋 Opção 1: Verificando builds EAS...${NC}"

# Verificar se está logado no EAS
if npx eas-cli whoami > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Logado no EAS${NC}"
    
    # Listar builds de desenvolvimento
    echo -e "${YELLOW}🔍 Buscando build de desenvolvimento...${NC}"
    LATEST_BUILD=$(npx eas-cli build:list --platform android --profile development --limit 1 --json 2>/dev/null | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
    
    if [ -n "$LATEST_BUILD" ]; then
        echo -e "${GREEN}✅ Build EAS encontrado: $LATEST_BUILD${NC}"
        echo ""
        echo "📥 Baixando build EAS..."
        
        # Criar diretório temporário
        TEMP_DIR=$(mktemp -d)
        cd "$TEMP_DIR"
        
        if npx eas-cli build:download --id "$LATEST_BUILD" --platform android 2>/dev/null; then
            APK_FILE=$(find . -name "*.apk" | head -1)
            if [ -n "$APK_FILE" ]; then
                cd "$OLDPWD"
                install_apk "$TEMP_DIR/$APK_FILE"
                rm -rf "$TEMP_DIR"
                exit 0
            fi
        fi
        
        cd "$OLDPWD"
        rm -rf "$TEMP_DIR"
        echo -e "${YELLOW}⚠️ Não foi possível baixar o build EAS${NC}"
    else
        echo -e "${YELLOW}⚠️ Nenhum build EAS de desenvolvimento encontrado${NC}"
    fi
else
    echo -e "${YELLOW}⚠️ Não está logado no EAS${NC}"
fi

echo ""

# Opção 2: Usar APK local mais recente
echo -e "${BLUE}📋 Opção 2: Buscando APK local...${NC}"

# Buscar APKs de desenvolvimento
LATEST_APK=$(ls -t leaf-app-dev-*.apk 2>/dev/null | head -1)

if [ -n "$LATEST_APK" ] && [ -f "$LATEST_APK" ]; then
    echo -e "${GREEN}✅ APK local encontrado: $LATEST_APK${NC}"
    SIZE=$(du -h "$LATEST_APK" | cut -f1)
    DATE=$(stat -c %y "$LATEST_APK" | cut -d' ' -f1)
    echo "   Tamanho: $SIZE"
    echo "   Data: $DATE"
    echo ""
    
    install_apk "$LATEST_APK"
    
    if [ $? -eq 0 ]; then
        echo ""
        echo -e "${GREEN}🎉 INSTALAÇÃO CONCLUÍDA!${NC}"
        echo ""
        echo "📱 Próximos passos:"
        echo "1. O app foi instalado no dispositivo"
        echo "2. Abra o app Leaf no dispositivo"
        echo "3. Configure as credenciais se necessário"
        echo ""
        echo "🔧 Comandos úteis:"
        echo "   - Ver logs: adb logcat | grep -E '(Leaf|ReactNative|Expo)'"
        echo "   - Abrir app: adb shell am start -n br.com.leaf.ride/.MainActivity"
        echo "   - Limpar dados: adb shell pm clear br.com.leaf.ride"
        exit 0
    fi
else
    echo -e "${YELLOW}⚠️ Nenhum APK local encontrado${NC}"
fi

echo ""

# Opção 3: Criar novo build
echo -e "${BLUE}📋 Opção 3: Criar novo build${NC}"
echo ""
echo "Escolha uma opção:"
echo "  1. Criar build local (rápido, ~5-10 min)"
echo "  2. Criar build EAS (mais lento, ~15-30 min)"
echo "  0. Cancelar"
echo ""
read -p "Escolha (0-2): " choice

case $choice in
    1)
        echo ""
        echo -e "${YELLOW}🔨 Criando build local...${NC}"
        if [ -f "build-dev.sh" ]; then
            ./build-dev.sh
        else
            echo -e "${RED}❌ Script build-dev.sh não encontrado${NC}"
            exit 1
        fi
        
        # Tentar instalar o APK gerado
        NEW_APK=$(ls -t leaf-app-dev-*.apk 2>/dev/null | head -1)
        if [ -n "$NEW_APK" ] && [ -f "$NEW_APK" ]; then
            install_apk "$NEW_APK"
        fi
        ;;
    2)
        echo ""
        echo -e "${YELLOW}🔨 Criando build EAS...${NC}"
        echo "⏳ Isso pode levar 15-30 minutos..."
        echo ""
        npx eas-cli build --platform android --profile development
        
        echo ""
        echo -e "${GREEN}✅ Build criado!${NC}"
        echo "Execute este script novamente para instalar"
        ;;
    0)
        echo "Cancelado"
        exit 0
        ;;
    *)
        echo -e "${RED}❌ Opção inválida${NC}"
        exit 1
        ;;
esac

