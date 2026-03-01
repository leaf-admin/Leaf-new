#!/bin/bash

# Script para instalar dependências no VPS
# Uso: Copiar mobile-app para VPS e rodar este script lá

echo "════════════════════════════════════════"
echo "   📦 INSTALANDO DEPENDÊNCIAS NO VPS"
echo "════════════════════════════════════════"
echo ""

# Verificar se está no diretório correto
if [ ! -f "package.json" ]; then
    echo "❌ Erro: package.json não encontrado"
    echo "   Execute este script dentro do diretório mobile-app"
    exit 1
fi

echo "📦 Instalando dependências..."
npm install --legacy-peer-deps

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Dependências instaladas com sucesso!"
    echo ""
    echo "📋 Próximos passos:"
    echo "   1. Verificar se expo-image-manipulator foi instalado:"
    echo "      ls node_modules/expo-image-manipulator"
    echo ""
    echo "   2. Fazer build:"
    echo "      eas build --platform android"
    echo ""
else
    echo ""
    echo "❌ Erro ao instalar dependências"
    exit 1
fi

