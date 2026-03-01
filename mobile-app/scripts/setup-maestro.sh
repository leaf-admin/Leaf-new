#!/bin/bash

# Script de Setup do Maestro para Testes E2E
# Versão: 1.0.0

set -e

echo "🎭 Configurando Maestro para Testes E2E"
echo "========================================"
echo ""

# Cores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Verificar se está no diretório correto
if [ ! -f "package.json" ]; then
    echo "❌ Execute este script no diretório mobile-app"
    exit 1
fi

echo -e "${BLUE}📦 Instalando Maestro...${NC}"

# Instalar Maestro
if command -v maestro &> /dev/null; then
    echo -e "${GREEN}✅ Maestro já está instalado${NC}"
    maestro --version
else
    echo "Instalando Maestro..."
    curl -Ls "https://get.maestro.mobile.dev" | bash
    
    # Adicionar ao PATH se necessário
    if [ -d "$HOME/.maestro/bin" ]; then
        export PATH="$PATH:$HOME/.maestro/bin"
        echo -e "${GREEN}✅ Maestro instalado em ~/.maestro/bin${NC}"
        echo -e "${YELLOW}💡 Adicione ao seu ~/.bashrc ou ~/.zshrc:${NC}"
        echo "export PATH=\"\$PATH:\$HOME/.maestro/bin\""
    fi
fi

echo ""
echo -e "${BLUE}📁 Verificando estrutura de diretórios...${NC}"

# Criar diretórios se não existirem
mkdir -p .maestro/flows/auth
mkdir -p .maestro/flows/rides
mkdir -p .maestro/flows/payments
mkdir -p .maestro/helpers
mkdir -p .maestro/screenshots

echo -e "${GREEN}✅ Estrutura de diretórios criada${NC}"

echo ""
echo -e "${BLUE}🔍 Verificando arquivos de teste...${NC}"

# Verificar se os arquivos de teste existem
if [ -f ".maestro/flows/auth/01-login-customer.yaml" ]; then
    echo -e "${GREEN}✅ Arquivos de teste encontrados${NC}"
else
    echo -e "${YELLOW}⚠️  Arquivos de teste não encontrados. Execute o setup novamente.${NC}"
fi

echo ""
echo -e "${BLUE}📱 Verificando dispositivos Android...${NC}"

# Verificar se há emulador/dispositivo Android conectado
if command -v adb &> /dev/null; then
    DEVICES=$(adb devices | grep -v "List" | grep "device" | wc -l)
    if [ "$DEVICES" -gt 0 ]; then
        echo -e "${GREEN}✅ Dispositivo(s) Android encontrado(s)${NC}"
        adb devices
    else
        echo -e "${YELLOW}⚠️  Nenhum dispositivo Android conectado${NC}"
        echo "   Conecte um dispositivo ou inicie um emulador"
    fi
else
    echo -e "${YELLOW}⚠️  ADB não encontrado. Instale Android SDK.${NC}"
fi

echo ""
echo -e "${GREEN}✅ Setup concluído!${NC}"
echo ""
echo "📚 Próximos passos:"
echo "   1. Build do app: npm run android"
echo "   2. Executar testes: npm run test:e2e"
echo "   3. Ver documentação: cat .maestro/README.md"
echo ""













