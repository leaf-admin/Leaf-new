#!/bin/bash

# 🚀 SCRIPT DE INSTALAÇÃO DO APK DE PRODUÇÃO - LEAF APP
# Gerado em: $(date)

echo "🚀 INSTALANDO APK DE PRODUÇÃO - LEAF APP"
echo "========================================"

APK_PATH="/home/izaak-dias/Downloads/1. leaf/main/Sourcecode/mobile-app/leaf-app-production-test.apk"

# Verificar se o APK existe
if [ ! -f "$APK_PATH" ]; then
    echo "❌ APK não encontrado em: $APK_PATH"
    exit 1
fi

echo "📱 APK encontrado: $(ls -lh "$APK_PATH" | awk '{print $5}')"
echo ""

# Verificar se o dispositivo está conectado
echo "🔍 Verificando dispositivos conectados..."
adb devices

echo ""
echo "📲 Instalando APK no dispositivo..."
adb install -r "$APK_PATH"

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ APK INSTALADO COM SUCESSO!"
    echo ""
    echo "🎯 PRÓXIMOS PASSOS:"
    echo "1. Abra o app 'Leaf' no dispositivo"
    echo "2. Teste com usuário DRIVER: 11999999999"
    echo "3. Teste com usuário CUSTOMER: 11888888888"
    echo ""
    echo "🔧 CONFIGURAÇÕES:"
    echo "- Servidor VPS: 216.238.107.59:3001"
    echo "- Todos os bypasses ativos"
    echo "- Status online persistente"
    echo ""
    echo "🚀 PRONTO PARA TESTES INDEPENDENTES!"
else
    echo "❌ Falha na instalação do APK"
    exit 1
fi

