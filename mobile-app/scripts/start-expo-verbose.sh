#!/bin/bash

# Script para iniciar Expo com logs verbosos e erros visíveis
# Uso: bash scripts/start-expo-verbose.sh

set -e

echo "════════════════════════════════════════"
echo "   🚀 INICIANDO EXPO (VERBOSO)"
echo "════════════════════════════════════════"
echo ""

# Verificar se está no diretório correto
if [ ! -f "package.json" ]; then
    echo "❌ ERRO: Execute este script dentro do diretório mobile-app"
    exit 1
fi

# Verificar se node_modules existe
if [ ! -d "node_modules/expo" ]; then
    echo "❌ ERRO: node_modules/expo não encontrado!"
    echo "   Execute: npm install primeiro"
    exit 1
fi

echo "📝 Todos os logs serão mostrados aqui"
echo "💡 Pressione Ctrl+C para parar"
echo ""
echo "════════════════════════════════════════"
echo ""

# Rodar Expo com output não-buffered e mostrar tudo
NODE_ENV=development \
node --trace-warnings \
  node_modules/expo/bin/cli start --dev-client \
  2>&1 | tee /tmp/expo-verbose.log

