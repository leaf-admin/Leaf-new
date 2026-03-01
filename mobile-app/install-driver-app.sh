#!/bin/bash

echo "🚗 INSTALANDO LEAF APP - VERSÃO MOTORISTA"
echo "=========================================="

# Verificar se o dispositivo está conectado
echo "📱 Verificando dispositivos conectados..."
adb devices

echo ""
echo "📦 APK disponível: leaf-app-driver.apk (151MB)"
echo "📍 Localização: $(pwd)/leaf-app-driver.apk"
echo ""

# Instalar APK
echo "⚡ Instalando APK..."
adb install -r leaf-app-driver.apk

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ INSTALAÇÃO CONCLUÍDA!"
    echo "📱 Abra o app 'Leaf' no dispositivo"
    echo "🔑 Teste o Firebase e Google Sign-In"
    echo ""
    echo "🚀 PRÓXIMOS PASSOS:"
    echo "1. Abra o app no dispositivo"
    echo "2. Teste autenticação Firebase"
    echo "3. Cadastre como motorista"
    echo "4. Conecte na porta 8082"
else
    echo ""
    echo "❌ ERRO NA INSTALAÇÃO!"
    echo "🔍 Verifique se o dispositivo está conectado"
    echo "📱 Verifique se o USB Debug está ativo"
fi
