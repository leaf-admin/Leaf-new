#!/bin/bash

# Script para gerar builds locais: RELEASE (motorista) e DEVELOPMENT (passageiro)

echo ""
echo "════════════════════════════════════════"
echo "   📱 GERANDO BUILDS LOCAIS"
echo "════════════════════════════════════════"
echo ""

# Verificar se há dispositivo conectado
if ! adb devices | grep -q "device$"; then
    echo "❌ Nenhum dispositivo Android conectado!"
    echo "   Conecte um dispositivo via USB e habilite depuração USB"
    exit 1
fi

DEVICE_COUNT=$(adb devices | grep "device$" | wc -l)
echo "✅ $DEVICE_COUNT dispositivo(s) Android conectado(s)"
echo ""

# 1. BUILD RELEASE (MOTORISTA)
echo "════════════════════════════════════════"
echo "   1️⃣  BUILD RELEASE (MOTORISTA)"
echo "════════════════════════════════════════"
echo ""
echo "📱 Esta build será instalada no dispositivo conectado"
echo "⏳ Gerando build RELEASE..."
echo ""

node node_modules/expo/bin/cli run:android --variant release

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Build RELEASE gerada e instalada com sucesso!"
    echo ""
    
    # 2. BUILD DEVELOPMENT (PASSAGEIRO)
    echo "════════════════════════════════════════"
    echo "   2️⃣  BUILD DEVELOPMENT (PASSAGEIRO)"
    echo "════════════════════════════════════════"
    echo ""
    echo "📱 Esta build será gerada como APK para instalar em outro dispositivo"
    echo "⏳ Gerando build DEVELOPMENT..."
    echo ""
    
    node node_modules/expo/bin/cli run:android --variant debug
    
    if [ $? -eq 0 ]; then
        echo ""
        echo "✅ Build DEVELOPMENT gerada com sucesso!"
        echo ""
        echo "════════════════════════════════════════"
        echo "   ✅ TODAS AS BUILDS GERADAS"
        echo "════════════════════════════════════════"
        echo ""
        echo "📱 APKs gerados em:"
        echo "   • RELEASE: android/app/build/outputs/apk/release/app-release.apk"
        echo "   • DEVELOPMENT: android/app/build/outputs/apk/debug/app-debug.apk"
        echo ""
        echo "💡 Para instalar a DEVELOPMENT em outro dispositivo:"
        echo "   adb install android/app/build/outputs/apk/debug/app-debug.apk"
        echo ""
    else
        echo ""
        echo "❌ Erro ao gerar build DEVELOPMENT"
        exit 1
    fi
else
    echo ""
    echo "❌ Erro ao gerar build RELEASE"
    exit 1
fi

