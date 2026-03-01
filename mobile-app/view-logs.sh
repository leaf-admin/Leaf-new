#!/bin/bash

# Script para visualizar logs em tempo real
# Uso: ./view-logs.sh [1|2]
#   1 = Motorista (Dispositivo 1)
#   2 = Passageiro (Dispositivo 2)

DEVICE_NUM=${1:-1}

if [ "$DEVICE_NUM" == "1" ]; then
    DEVICE_ID="8DZLY9XSJZLVDAX8"
    DEVICE_NAME="Motorista"
    LOG_FILE="logs-device-1-motorista.log"
    FILTER="(ReactNativeJS|LOG|ERROR|WARN|DriverUI|WebSocket|acceptRide|startTrip|endTrip|chat|message)"
elif [ "$DEVICE_NUM" == "2" ]; then
    DEVICE_ID="irsgaiscr4j7cenv"
    DEVICE_NAME="Passageiro"
    LOG_FILE="logs-device-2-passageiro.log"
    FILTER="(ReactNativeJS|LOG|ERROR|WARN|PassengerUI|WebSocket|requestRide|rideAccepted|driverLocation|chat|message)"
else
    echo "❌ Uso: ./view-logs.sh [1|2]"
    echo "   1 = Motorista"
    echo "   2 = Passageiro"
    exit 1
fi

echo "📱 Visualizando logs do Dispositivo $DEVICE_NUM ($DEVICE_NAME)"
echo "🔍 Pressione Ctrl+C para parar"
echo ""

# Limpa logs antigos e inicia monitoramento ao vivo
adb -s "$DEVICE_ID" logcat -c
adb -s "$DEVICE_ID" logcat | grep -E "$FILTER" --color=always

