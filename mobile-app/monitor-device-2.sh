#!/bin/bash

# Script para monitorar logs do Dispositivo 2 (Passageiro)
# Uso: ./monitor-device-2.sh

DEVICES=$(adb devices -l | grep -v "List of devices" | grep "device" | awk '{print $1}')

DEVICE_COUNT=$(echo "$DEVICES" | wc -l)

if [ "$DEVICE_COUNT" -lt 2 ]; then
    echo "❌ É necessário ter 2 dispositivos conectados!"
    echo "Dispositivos encontrados: $DEVICE_COUNT"
    exit 1
fi

# Pega o segundo dispositivo
DEVICE_ID=$(echo "$DEVICES" | tail -1)

echo "📱 Monitorando Dispositivo 2 (Passageiro): $DEVICE_ID"
echo "🔍 Filtrando logs do React Native..."
echo ""

adb -s "$DEVICE_ID" logcat -c  # Limpa logs antigos
adb -s "$DEVICE_ID" logcat | grep -E "(ReactNativeJS|LOG|ERROR|WARN|PassengerUI|WebSocket)" --color=always

