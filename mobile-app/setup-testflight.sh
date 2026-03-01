#!/bin/bash

# 🍎 Script de Configuração e Build para TestFlight
# Facilita o processo de preparação do app iOS para TestFlight

set -e

cd "$(dirname "$0")"

echo "🍎 CONFIGURAÇÃO iOS PARA TESTFLIGHT"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Cores para output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Função para verificar se comando existe
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Verificar pré-requisitos
echo "🔍 Verificando pré-requisitos..."
echo ""

# Verificar EAS CLI
if ! command_exists eas-cli; then
    echo -e "${YELLOW}⚠️ EAS CLI não encontrado. Instalando...${NC}"
    npm install -g eas-cli
else
    echo -e "${GREEN}✅ EAS CLI instalado${NC}"
fi

# Verificar login
echo ""
echo "🔐 Verificando login EAS..."
if npx eas-cli whoami > /dev/null 2>&1; then
    USER=$(npx eas-cli whoami)
    echo -e "${GREEN}✅ Logado como: $USER${NC}"
else
    echo -e "${YELLOW}⚠️ Não está logado. Fazendo login...${NC}"
    npx eas-cli login
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Menu principal
echo "📋 Escolha uma opção:"
echo ""
echo "  1. 🔧 Configurar credenciais iOS (primeira vez)"
echo "  2. 🏗️  Criar build para TestFlight"
echo "  3. 📊 Ver status dos builds"
echo "  4. 📥 Baixar último build"
echo "  5. ✅ Verificar configuração do app"
echo "  6. 🚀 Submeter para App Store (após TestFlight)"
echo "  0. ❌ Sair"
echo ""
read -p "Escolha (0-6): " choice

case $choice in
    1)
        echo ""
        echo "🔧 Configurando credenciais iOS..."
        echo ""
        npx eas-cli credentials
        echo ""
        echo -e "${GREEN}✅ Credenciais configuradas!${NC}"
        ;;
    2)
        echo ""
        echo "🏗️ Criando build para TestFlight..."
        echo ""
        echo "📋 Perfis disponíveis:"
        echo "  1. Production (para TestFlight/App Store)"
        echo "  2. Preview (para testes internos)"
        echo ""
        read -p "Escolha o perfil (1 ou 2): " profile_choice
        
        if [ "$profile_choice" = "1" ]; then
            PROFILE="production"
            echo ""
            echo "🚀 Iniciando build PRODUCTION para TestFlight..."
        elif [ "$profile_choice" = "2" ]; then
            PROFILE="preview"
            echo ""
            echo "🚀 Iniciando build PREVIEW para testes internos..."
        else
            echo -e "${RED}❌ Opção inválida${NC}"
            exit 1
        fi
        
        echo ""
        echo "⏳ Isso pode levar 15-30 minutos..."
        echo ""
        
        npx eas-cli build --platform ios --profile "$PROFILE"
        
        echo ""
        echo -e "${GREEN}✅ Build iniciado!${NC}"
        echo ""
        echo "📊 Para acompanhar o progresso:"
        echo "   npx eas-cli build:list --platform ios --limit 1"
        ;;
    3)
        echo ""
        echo "📊 Status dos builds iOS:"
        echo ""
        npx eas-cli build:list --platform ios --limit 5
        ;;
    4)
        echo ""
        echo "📥 Baixando último build iOS..."
        echo ""
        npx eas-cli build:download --platform ios --latest
        echo ""
        echo -e "${GREEN}✅ Build baixado!${NC}"
        ;;
    5)
        echo ""
        echo "✅ Verificando configuração do app..."
        echo ""
        echo "📋 Configuração atual:"
        npx expo config --type public | grep -A 10 "ios:"
        echo ""
        echo "📋 Versão:"
        npx expo config --type public | grep -E "version|runtimeVersion"
        ;;
    6)
        echo ""
        echo "🚀 Submetendo para App Store..."
        echo ""
        echo "⚠️ ATENÇÃO: Isso submeterá o app para revisão da Apple!"
        echo ""
        read -p "Tem certeza? (s/N): " confirm
        
        if [ "$confirm" = "s" ] || [ "$confirm" = "S" ]; then
            npx eas-cli submit --platform ios
            echo ""
            echo -e "${GREEN}✅ Submissão iniciada!${NC}"
        else
            echo "❌ Submissão cancelada"
        fi
        ;;
    0)
        echo ""
        echo "👋 Até logo!"
        exit 0
        ;;
    *)
        echo -e "${RED}❌ Opção inválida${NC}"
        exit 1
        ;;
esac

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📚 Próximos passos:"
echo ""
echo "  1. Aguardar processamento do build (5-30 min)"
echo "  2. Acessar App Store Connect: https://appstoreconnect.apple.com"
echo "  3. Ir em TestFlight → Seu app"
echo "  4. Adicionar testadores"
echo "  5. Atribuir build aos testadores"
echo ""
echo "📖 Guia completo: GUIA_TESTFLIGHT_IOS.md"
echo ""

