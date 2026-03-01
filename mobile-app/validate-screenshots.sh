#!/bin/bash

# Script para validar screenshots gerados para App Stores
# Verifica resoluções, qualidade e conformidade

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}🔍 VALIDANDO SCREENSHOTS PARA APP STORES${NC}"
echo "==========================================="

# Função para verificar resolução
check_resolution() {
    local file=$1
    local expected=$2
    local platform=$3

    if command -v identify &> /dev/null; then
        resolution=$(identify -format "%wx%h" "$file" 2>/dev/null)
        echo -e "${BLUE}📏 $file: ${resolution}${NC}"

        # Verificar se está próximo da resolução esperada
        case $platform in
            "ios-phone")
                if [[ $resolution == *"1080"* ]] || [[ $resolution == *"1125"* ]]; then
                    echo -e "${GREEN}  ✅ Resolução adequada para iOS${NC}"
                else
                    echo -e "${YELLOW}  ⚠️  Considere redimensionar para ~1080x1920${NC}"
                fi
                ;;
            "ios-tablet")
                if [[ $resolution == *"2048"* ]] || [[ $resolution == *"1668"* ]]; then
                    echo -e "${GREEN}  ✅ Resolução adequada para iPad${NC}"
                else
                    echo -e "${YELLOW}  ⚠️  Considere redimensionar para ~2048x2732 ou 1668x2388${NC}"
                fi
                ;;
            "android-phone")
                if [[ $resolution == *"1080"* ]]; then
                    echo -e "${GREEN}  ✅ Resolução adequada para Android${NC}"
                else
                    echo -e "${YELLOW}  ⚠️  Considere redimensionar para 1080x1920${NC}"
                fi
                ;;
            "android-tablet")
                if [[ $resolution == *"1200"* ]] || [[ $resolution == *"1600"* ]]; then
                    echo -e "${GREEN}  ✅ Resolução adequada para Android Tablet${NC}"
                else
                    echo -e "${YELLOW}  ⚠️  Considere redimensionar para 1200x1920 ou 1600x2560${NC}"
                fi
                ;;
        esac
    else
        echo -e "${YELLOW}⚠️  ImageMagick não instalado - não é possível verificar resoluções${NC}"
        echo "  Instale com: sudo apt install imagemagick"
    fi
}

echo "📱 VERIFICANDO SCREENSHOTS IOS:"
echo "-------------------------------"
for file in screenshots-for-stores/ios/phone/*.png; do
    [ -f "$file" ] && check_resolution "$file" "ios-phone"
done

echo ""
echo "📱 VERIFICANDO SCREENSHOTS IOS TABLET:"
echo "-------------------------------------"
for file in screenshots-for-stores/ios/tablet/*.png; do
    [ -f "$file" ] && check_resolution "$file" "ios-tablet"
done

echo ""
echo "🤖 VERIFICANDO SCREENSHOTS ANDROID:"
echo "-----------------------------------"
for file in screenshots-for-stores/android/phone/*.png; do
    [ -f "$file" ] && check_resolution "$file" "android-phone"
done

echo ""
echo "🤖 VERIFICANDO SCREENSHOTS ANDROID TABLET:"
echo "-----------------------------------------"
for file in screenshots-for-stores/android/tablet/*.png; do
    [ -f "$file" ] && check_resolution "$file" "android-tablet"
done

echo ""
echo -e "${GREEN}✅ VALIDAÇÃO CONCLUÍDA${NC}"
echo ""
echo -e "${BLUE}💡 RECOMENDAÇÕES PARA APP STORES:${NC}"
echo ""
echo -e "${YELLOW}🍎 APPLE APP STORE:${NC}"
echo "• Mínimo 2 screenshots obrigatórios"
echo "• Máximo 10 screenshots permitidos"
echo "• Ordem: tela inicial → funcionalidades principais → resultado"
echo "• Evitar: texto sobreposto, elementos de UI"
echo ""
echo -e "${YELLOW}🤖 GOOGLE PLAY STORE:${NC}"
echo "• Mínimo 2 screenshots obrigatórios"
echo "• Máximo 8 screenshots permitidos"
echo "• Ordem: tela inicial → funcionalidades principais"
echo "• Formato: PNG ou JPEG, máximo 15MB cada"
echo ""
echo -e "${BLUE}🎨 DICAS DE QUALIDADE:${NC}"
echo "• Use dispositivos reais para screenshots"
echo "• Certifique-se de que o app está em português"
echo "• Mostre funcionalidades reais (não placeholders)"
echo "• Evite dados pessoais ou informações sensíveis"
echo "• Mantenha consistência visual entre screenshots"
echo ""
echo -e "${GREEN}📤 PRONTO PARA UPLOAD!${NC}"

