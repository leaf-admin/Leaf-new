#!/bin/bash

# Script para monitorar logs do Dispositivo 1 (Motorista)
# Uso: ./monitor-device-1.sh

DEVICE_ID=$(adb devices -l | grep -v "List of devices" | grep "device" | head -1 | awk '{print $1}')

if [ -z "$DEVICE_ID" ]; then
    echo "❌ Nenhum dispositivo encontrado!"
    echo "Conecte o dispositivo 1 (Motorista) via USB e tente novamente."
    exit 1
fi

echo "📱 Monitorando Dispositivo 1 (Motorista): $DEVICE_ID"
echo "🔍 Filtrando logs do React Native..."
echo ""

adb -s "$DEVICE_ID" logcat -c  # Limpa logs antigos
adb -s "$DEVICE_ID" logcat | grep -E "(ReactNativeJS|LOG|ERROR|WARN|DriverUI|WebSocket)" --color=always

