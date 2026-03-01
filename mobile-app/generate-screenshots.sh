#!/bin/bash

# Script para gerar screenshots para App Stores usando Maestro
# Este script executa testes e organiza screenshots automaticamente

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}📱 GERANDO SCREENSHOTS PARA APP STORES${NC}"
echo "=========================================="

# Verificar se Maestro está instalado
if ! command -v maestro &> /dev/null; then
    echo -e "${RED}❌ Maestro não está instalado${NC}"
    echo "Instale o Maestro: https://maestro.mobile.dev/"
    exit 1
fi

# Verificar se há dispositivos conectados
if ! adb devices | grep -q "device$"; then
    echo -e "${YELLOW}⚠️  Nenhum dispositivo Android conectado${NC}"
    echo "Conecte um dispositivo ou inicie um emulador"
    echo "Para continuar mesmo assim (usando screenshots existentes), pressione Enter"
    read -p "Ou pressione Ctrl+C para cancelar: "
fi

# Criar diretório para screenshots
mkdir -p screenshots-for-stores/{ios,android}/{phone,tablet}

echo -e "${GREEN}✅ Ambiente preparado${NC}"

# Executar teste de screenshots
echo -e "${BLUE}📸 Executando testes de screenshots...${NC}"
maestro test .maestro/flows/screenshots-for-stores.yaml \
    --format junit \
    --output screenshots-for-stores/results.xml

echo -e "${GREEN}✅ Screenshots gerados${NC}"

# Organizar screenshots por resolução
echo -e "${BLUE}📂 Organizando screenshots...${NC}"

# Mover screenshots para diretórios apropriados
find .maestro/screenshots/ -name "*.png" -newer screenshots-for-stores/results.xml 2>/dev/null | while read screenshot; do
    filename=$(basename "$screenshot")

    # Determinar resolução aproximada (simplificada)
    resolution=$(identify -format "%wx%h" "$screenshot" 2>/dev/null || echo "1080x1920")

    case $resolution in
        *"2796"*|*"2688"*)
            # iPhone grandes
            cp "$screenshot" "screenshots-for-stores/ios/phone/$filename"
            ;;
        *"2048"*|*"2732"*|*"1668"*|*"2388"*)
            # iPad
            cp "$screenshot" "screenshots-for-stores/ios/tablet/$filename"
            ;;
        *"1920"*)
            # Android phone/tablet
            if [[ $resolution == *"1080"* ]]; then
                cp "$screenshot" "screenshots-for-stores/android/phone/$filename"
            else
                cp "$screenshot" "screenshots-for-stores/android/tablet/$filename"
            fi
            ;;
        *)
            # Default para Android phone
            cp "$screenshot" "screenshots-for-stores/android/phone/$filename"
            ;;
    esac
done

echo -e "${GREEN}✅ Screenshots organizados${NC}"

# Mostrar resultado final
echo ""
echo -e "${GREEN}🎉 SCREENSHOTS GERADOS COM SUCESSO!${NC}"
echo ""
echo "📂 Estrutura criada:"
echo "screenshots-for-stores/"
echo "├── ios/"
echo "│   ├── phone/     # iPhone screenshots"
echo "│   └── tablet/    # iPad screenshots"
echo "└── android/"
echo "    ├── phone/     # Phone screenshots"
echo "    └── tablet/    # Tablet screenshots"
echo ""

# Contar screenshots gerados
ios_phone_count=$(ls screenshots-for-stores/ios/phone/*.png 2>/dev/null | wc -l)
ios_tablet_count=$(ls screenshots-for-stores/ios/tablet/*.png 2>/dev/null | wc -l)
android_phone_count=$(ls screenshots-for-stores/android/phone/*.png 2>/dev/null | wc -l)
android_tablet_count=$(ls screenshots-for-stores/android/tablet/*.png 2>/dev/null | wc -l)

echo "📊 Estatísticas:"
echo "• iOS Phone: $ios_phone_count screenshots"
echo "• iOS Tablet: $ios_tablet_count screenshots"
echo "• Android Phone: $android_phone_count screenshots"
echo "• Android Tablet: $android_tablet_count screenshots"
echo ""

echo -e "${BLUE}💡 PRÓXIMOS PASSOS:${NC}"
echo "1. Verifique os screenshots gerados"
echo "2. Edite/remova screenshots indesejados"
echo "3. Faça upload para as respectivas App Stores"
echo ""

echo -e "${GREEN}✅ Processo concluído!${NC}"

