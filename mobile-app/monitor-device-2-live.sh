#!/bin/bash

# Monitoramento ao vivo do Dispositivo 2 (Passageiro)
DEVICE_ID="irsgaiscr4j7cenv"

echo "📱 Monitorando Dispositivo 2 (Passageiro): $DEVICE_ID"
echo "🔍 Pressione Ctrl+C para parar"
echo ""

adb -s "$DEVICE_ID" logcat -c
adb -s "$DEVICE_ID" logcat | grep -E "(ReactNativeJS|LOG|ERROR|WARN|PassengerUI|WebSocket|requestRide|rideAccepted|driverLocation)" --color=always

