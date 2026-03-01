#!/bin/bash

# Script para instalar a build de desenvolvimento em ambos os dispositivos
# Uso: ./install-both-devices.sh

APK_FILE=$(ls -t leaf-app-dev-*.apk 2>/dev/null | head -1)

if [ -z "$APK_FILE" ]; then
    echo "❌ Nenhum APK de desenvolvimento encontrado!"
    echo "Execute primeiro: ./build-dev.sh"
    exit 1
fi

DEVICES=$(adb devices -l | grep -v "List of devices" | grep "device" | awk '{print $1}')

if [ -z "$DEVICES" ]; then
    echo "❌ Nenhum dispositivo conectado!"
    exit 1
fi

DEVICE_COUNT=$(echo "$DEVICES" | wc -l)
echo "📱 Dispositivos encontrados: $DEVICE_COUNT"
echo ""

# Instala em todos os dispositivos
for DEVICE_ID in $DEVICES; do
    echo "📲 Instalando em: $DEVICE_ID"
    adb -s "$DEVICE_ID" install -r "$APK_FILE"
    if [ $? -eq 0 ]; then
        echo "✅ Instalado com sucesso em $DEVICE_ID"
    else
        echo "❌ Erro ao instalar em $DEVICE_ID"
    fi
    echo ""
done

echo "✅ Instalação concluída!"

