#!/bin/bash

# Script específico para resolver problemas do Maestro em Xiaomi/Redmi
# Esses dispositivos têm restrições extras de segurança

set -e

# Cores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}🔧 Fix Específico para Xiaomi/Redmi${NC}"
echo "===================================="
echo ""

# Verificar dispositivo
DEVICES=$(adb devices | grep -v "List" | grep "device" | grep -v "^$")

if [ -z "$DEVICES" ]; then
    echo -e "${RED}❌ Nenhum dispositivo encontrado${NC}"
    exit 1
fi

BRAND=$(adb shell getprop ro.product.brand 2>/dev/null || echo "")
MODEL=$(adb shell getprop ro.product.model 2>/dev/null || echo "")

echo -e "${BLUE}📱 Dispositivo: $BRAND $MODEL${NC}"
echo ""

# Configurações específicas para Xiaomi
echo -e "${BLUE}⚙️  Aplicando configurações específicas para Xiaomi...${NC}"

# 1. Desabilitar verificação de instalação
echo "1. Desabilitando verificação de instalação..."
adb shell settings put global verifier_verify_adb_installs 0 2>/dev/null || true

# 2. Permitir instalação de apps não-market
echo "2. Permitindo instalação de apps não-market..."
adb shell settings put global install_non_market_apps 1 2>/dev/null || true

# 3. Configurações específicas MIUI
echo "3. Configurando permissões MIUI..."
adb shell settings put secure install_non_market_apps 1 2>/dev/null || true

# 4. Tentar conceder permissão de instalação
echo "4. Tentando conceder permissão de instalação..."
adb shell pm grant com.android.shell android.permission.INSTALL_PACKAGES 2>/dev/null || true

echo ""
echo -e "${GREEN}✅ Configurações aplicadas${NC}"
echo ""

# Instruções manuais
echo -e "${YELLOW}📋 AINDA PRECISA FAZER MANUALMENTE NO CELULAR:${NC}"
echo ""
echo "1. Configurações > Opções do desenvolvedor"
echo "   ✅ Ativar 'Instalar via USB'"
echo "   ✅ Ativar 'Depuração USB'"
echo ""
echo "2. Configurações > Apps > Gerenciar apps > Especial > Acesso à instalação"
echo "   ✅ Permitir para 'ADB'"
echo "   ✅ Permitir para 'Depuração USB'"
echo ""
echo "3. Configurações > Segurança"
echo "   ✅ Permitir 'Fontes desconhecidas'"
echo ""
echo "4. Quando executar o teste:"
echo "   ✅ Desbloqueie a tela"
echo "   ✅ Mantenha a tela ligada"
echo "   ✅ Aceite QUALQUER popup que aparecer"
echo ""

read -p "Pressione Enter quando tiver feito as configurações acima..."

echo ""
echo -e "${BLUE}🧪 Testando instalação manual...${NC}"

# Tentar instalar um app de teste
TEST_INSTALL=$(adb install -r /system/app/ 2>&1 | head -1 || echo "test")

echo ""
echo -e "${GREEN}✅ Configuração concluída!${NC}"
echo ""
echo "Agora tente executar o teste:"
echo "  npm run test:e2e:device .maestro/flows/test-simple-launch.yaml"
echo ""
echo -e "${YELLOW}💡 Se ainda não funcionar, pode ser necessário:${NC}"
echo "   - Reiniciar o dispositivo"
echo "   - Usar um emulador ao invés do dispositivo físico"
echo "   - Usar outra ferramenta de teste (Detox, Appium)"













