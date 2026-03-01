#!/bin/bash

# Script para buildar versão standalone do app para testes Maestro
# Esta versão não precisa do expo start rodando

set -e

# Cores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}📦 Buildando Versão Standalone para Maestro${NC}"
echo "=========================================="
echo ""

# Verificar se está no diretório correto
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ Execute este script no diretório mobile-app${NC}"
    exit 1
fi

echo -e "${BLUE}ℹ️  O Maestro precisa de uma versão standalone do app${NC}"
echo "   (não a versão dev que precisa do expo start)"
echo ""

# Verificar se EAS está configurado
if [ ! -f "eas.json" ]; then
    echo -e "${YELLOW}⚠️  eas.json não encontrado${NC}"
    echo "   Vamos buildar localmente..."
    BUILD_METHOD="local"
else
    echo -e "${GREEN}✅ EAS configurado${NC}"
    BUILD_METHOD="eas"
fi

echo ""
echo -e "${BLUE}📋 Opções de Build:${NC}"
echo "  1. Build local (mais rápido, sem EAS)"
echo "  2. Build EAS Preview (recomendado)"
echo "  3. Build EAS Production"
echo ""
read -p "Escolha uma opção (1-3): " BUILD_OPTION

case $BUILD_OPTION in
    1)
        echo ""
        echo -e "${BLUE}🔨 Buildando localmente...${NC}"
        echo -e "${YELLOW}💡 Isso pode levar alguns minutos...${NC}"
        echo ""
        
        # Build local usando expo
        npx expo run:android --variant release
        
        if [ $? -eq 0 ]; then
            echo ""
            echo -e "${GREEN}✅ Build concluído!${NC}"
            echo ""
            echo -e "${BLUE}📱 Instalando no dispositivo...${NC}"
            adb install -r android/app/build/outputs/apk/release/app-release.apk
            
            if [ $? -eq 0 ]; then
                echo -e "${GREEN}✅ App instalado!${NC}"
            else
                echo -e "${RED}❌ Erro ao instalar. Tente manualmente:${NC}"
                echo "   adb install android/app/build/outputs/apk/release/app-release.apk"
            fi
        else
            echo -e "${RED}❌ Erro no build${NC}"
            exit 1
        fi
        ;;
    2)
        echo ""
        echo -e "${BLUE}☁️  Buildando via EAS Preview...${NC}"
        echo -e "${YELLOW}💡 Isso pode levar 10-20 minutos...${NC}"
        echo ""
        
        npx eas build --platform android --profile preview --local
        
        if [ $? -eq 0 ]; then
            echo ""
            echo -e "${GREEN}✅ Build concluído!${NC}"
            echo ""
            echo -e "${BLUE}📱 Instale o APK gerado manualmente${NC}"
            echo "   O arquivo estará em: build-*.apk"
        else
            echo -e "${RED}❌ Erro no build${NC}"
            exit 1
        fi
        ;;
    3)
        echo ""
        echo -e "${BLUE}☁️  Buildando via EAS Production...${NC}"
        echo -e "${YELLOW}💡 Isso pode levar 10-20 minutos...${NC}"
        echo ""
        
        npx eas build --platform android --profile production --local
        
        if [ $? -eq 0 ]; then
            echo ""
            echo -e "${GREEN}✅ Build concluído!${NC}"
            echo ""
            echo -e "${BLUE}📱 Instale o APK gerado manualmente${NC}"
            echo "   O arquivo estará em: build-*.apk"
        else
            echo -e "${RED}❌ Erro no build${NC}"
            exit 1
        fi
        ;;
    *)
        echo -e "${RED}❌ Opção inválida${NC}"
        exit 1
        ;;
esac

echo ""
echo -e "${GREEN}✅ Pronto! Agora você pode executar testes Maestro${NC}"
echo ""
echo -e "${BLUE}📝 Próximos passos:${NC}"
echo "  npm run test:e2e:device .maestro/flows/auth/01-login-customer-real.yaml"













