#!/bin/bash

# Script para diagnosticar problemas com Expo
# Uso: bash scripts/check-expo.sh

echo "════════════════════════════════════════"
echo "   🔍 DIAGNÓSTICO DO EXPO"
echo "════════════════════════════════════════"
echo ""

# Verificar diretório
if [ ! -f "package.json" ]; then
    echo "❌ ERRO: Execute este script dentro do diretório mobile-app"
    exit 1
fi

echo "1️⃣  Verificando Node.js..."
node --version || echo "❌ Node.js não encontrado"
echo ""

echo "2️⃣  Verificando npm..."
npm --version || echo "❌ npm não encontrado"
echo ""

echo "3️⃣  Verificando node_modules/expo..."
if [ -d "node_modules/expo" ]; then
    echo "   ✅ node_modules/expo existe"
    ls -la node_modules/expo/bin/cli 2>/dev/null && echo "   ✅ CLI encontrado" || echo "   ❌ CLI não encontrado"
else
    echo "   ❌ node_modules/expo não existe"
    echo "   💡 Execute: npm install"
fi
echo ""

echo "4️⃣  Testando execução do Expo CLI..."
if [ -f "node_modules/expo/bin/cli" ]; then
    echo "   Tentando executar: node node_modules/expo/bin/cli --version"
    node node_modules/expo/bin/cli --version 2>&1 | head -5 || echo "   ❌ Erro ao executar"
else
    echo "   ❌ CLI não encontrado"
fi
echo ""

echo "5️⃣  Verificando dependências críticas..."
for dep in "expo" "react-native" "@react-native-firebase/app"; do
    if [ -d "node_modules/$dep" ]; then
        echo "   ✅ $dep instalado"
    else
        echo "   ❌ $dep NÃO instalado"
    fi
done
echo ""

echo "6️⃣  Verificando permissões..."
if [ -w "node_modules" ]; then
    echo "   ✅ Permissão de escrita em node_modules"
else
    echo "   ❌ Sem permissão de escrita em node_modules"
fi
echo ""

echo "7️⃣  Verificando espaço em disco..."
df -h . | tail -1
echo ""

echo "════════════════════════════════════════"
echo "   📋 RESUMO"
echo "════════════════════════════════════════"
echo ""
echo "Se houver erros acima, corrija antes de continuar"
echo ""

