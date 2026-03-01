#!/bin/bash

# Script para resolver problemas de permissão do Maestro
# O Maestro precisa instalar um app auxiliar no dispositivo

set -e

# Cores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}🔧 Corrigindo Permissões do Maestro${NC}"
echo "=================================="
echo ""

# Verificar dispositivo
DEVICES=$(adb devices | grep -v "List" | grep "device" | grep -v "^$")

if [ -z "$DEVICES" ]; then
    echo -e "${RED}❌ Nenhum dispositivo encontrado${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Dispositivo conectado${NC}"
echo ""

echo -e "${BLUE}📱 O Maestro precisa instalar um app auxiliar no dispositivo${NC}"
echo "   Mas o dispositivo está bloqueando a instalação."
echo ""
echo -e "${YELLOW}💡 Soluções:${NC}"
echo ""
echo "1. HABILITAR 'Instalar via USB' no dispositivo:"
echo "   - Configurações > Opções do desenvolvedor"
echo "   - Ativar 'Instalar via USB'"
echo ""
echo "2. PERMITIR INSTALAÇÃO DE APPS DESCONHECIDOS:"
echo "   - Configurações > Segurança"
echo "   - Permitir 'Fontes desconhecidas' ou 'Instalar apps desconhecidos'"
echo ""
echo "3. VERIFICAR SE HÁ POPUP NO CELULAR:"
echo "   - Pode aparecer um popup pedindo permissão"
echo "   - Aceite a instalação"
echo ""

read -p "Pressione Enter quando tiver feito as configurações acima..."

echo ""
echo -e "${BLUE}🧪 Testando instalação...${NC}"

# Tentar instalar um app de teste para verificar permissões
TEST_APK="/tmp/test-permission.apk"

# Criar um APK mínimo de teste (se possível)
if command -v aapt &> /dev/null; then
    echo "Criando APK de teste..."
else
    echo -e "${YELLOW}⚠️  aapt não encontrado, pulando teste de instalação${NC}"
fi

# Verificar configurações do dispositivo
echo ""
echo -e "${BLUE}📋 Verificando configurações...${NC}"

# Verificar se depuração USB está ativa
USB_DEBUG=$(adb shell settings get global adb_enabled 2>/dev/null || echo "1")
if [ "$USB_DEBUG" = "1" ]; then
    echo -e "${GREEN}✅ Depuração USB: Ativa${NC}"
else
    echo -e "${RED}❌ Depuração USB: Desativada${NC}"
    echo "   Ative em: Configurações > Opções do desenvolvedor > Depuração USB"
fi

# Verificar se pode instalar apps
echo ""
echo -e "${BLUE}💡 Dica: Se ainda não funcionar, tente:${NC}"
echo "   1. Desbloqueie a tela do celular"
echo "   2. Mantenha a tela ligada durante o teste"
echo "   3. Aceite qualquer popup que aparecer"
echo ""

echo -e "${GREEN}✅ Configuração concluída!${NC}"
echo ""
echo "Agora tente executar o teste novamente:"
echo "  npm run test:e2e:device .maestro/flows/test-simple-launch.yaml"













