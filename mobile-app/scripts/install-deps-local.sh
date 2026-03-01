#!/bin/bash

# Script para instalar dependências em disco local temporário
# Uso: ./scripts/install-deps-local.sh

echo "════════════════════════════════════════"
echo "   📦 INSTALANDO EM DISCO LOCAL"
echo "════════════════════════════════════════"
echo ""

# Diretório temporário
TEMP_DIR="$HOME/temp-leaf-mobile-app"
CURRENT_DIR=$(pwd)

echo "📁 Criando diretório temporário: $TEMP_DIR"
mkdir -p "$TEMP_DIR"

echo "📦 Copiando mobile-app para disco local..."
rsync -av --exclude 'node_modules' --exclude '.expo' --exclude 'android' --exclude 'ios' \
    "$CURRENT_DIR/" "$TEMP_DIR/"

cd "$TEMP_DIR"

echo ""
echo "📦 Instalando dependências em disco local..."
npm install --legacy-peer-deps

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Dependências instaladas!"
    echo ""
    echo "📦 Copiando node_modules de volta..."
    rsync -av "$TEMP_DIR/node_modules/" "$CURRENT_DIR/node_modules/"
    
    echo ""
    echo "🧹 Limpando diretório temporário..."
    rm -rf "$TEMP_DIR"
    
    echo ""
    echo "✅ Pronto! Dependências instaladas no projeto original"
else
    echo ""
    echo "❌ Erro ao instalar dependências"
    echo "🧹 Limpando diretório temporário..."
    rm -rf "$TEMP_DIR"
    exit 1
fi

