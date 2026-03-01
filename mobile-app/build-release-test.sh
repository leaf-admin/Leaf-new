#!/bin/bash

# 🚀 Script para criar build de release para teste nos celulares
# Gera APK que pode ser instalado diretamente nos dispositivos

set -e

echo "🚀 Criando build de release para teste..."
echo ""

# Cores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Verificar se está no diretório correto
if [ ! -f "package.json" ]; then
    echo "❌ Execute este script dentro do diretório mobile-app"
    exit 1
fi

# Verificar se EAS CLI está instalado
if ! command -v eas &> /dev/null; then
    echo "📦 Instalando EAS CLI..."
    npm install -g eas-cli
fi

echo "✅ EAS CLI verificado"
echo ""

# Verificar se está logado no EAS
echo "🔐 Verificando autenticação EAS..."
if ! eas whoami &> /dev/null; then
    echo "⚠️  Você precisa estar logado no EAS"
    echo "   Execute: eas login"
    exit 1
fi

echo "✅ Autenticado no EAS"
echo ""

# Criar build APK para teste (preview profile gera APK)
echo "📱 Iniciando build Android APK (perfil preview)..."
echo "   Este build pode ser instalado diretamente nos celulares"
echo ""

# Build com perfil preview (gera APK)
npx eas build --platform android --profile preview --non-interactive

echo ""
echo "✅ Build iniciada!"
echo ""
echo "📋 Para acompanhar o progresso:"
echo "   npx eas build:list"
echo ""
echo "📥 Para baixar quando estiver pronta:"
echo "   npx eas build:list"
echo "   (clique no link do build ou use o ID para baixar)"
echo ""
echo "💡 Dica: O build será enviado por email quando estiver pronto"
echo ""


