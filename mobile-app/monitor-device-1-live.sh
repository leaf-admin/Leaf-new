#!/bin/bash

# Monitoramento ao vivo do Dispositivo 1 (Motorista)
DEVICE_ID="8DZLY9XSJZLVDAX8"

echo "📱 Monitorando Dispositivo 1 (Motorista): $DEVICE_ID"
echo "🔍 Pressione Ctrl+C para parar"
echo ""

adb -s "$DEVICE_ID" logcat -c
adb -s "$DEVICE_ID" logcat | grep -E "(ReactNativeJS|LOG|ERROR|WARN|DriverUI|WebSocket|acceptRide|startTrip|endTrip)" --color=always

