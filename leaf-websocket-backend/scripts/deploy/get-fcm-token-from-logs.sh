#!/bin/bash

# Script para extrair token FCM dos logs do dispositivo
# Uso: ./get-fcm-token-from-logs.sh [device_id]

DEVICE_ID=${1:-""}

if [ -z "$DEVICE_ID" ]; then
    DEVICES=$(adb devices -l | grep -v "List of devices" | grep "device" | awk '{print $1}')
    DEVICE_COUNT=$(echo "$DEVICES" | wc -l)
    
    if [ "$DEVICE_COUNT" -eq 0 ]; then
        echo "❌ Nenhum dispositivo conectado"
        exit 1
    elif [ "$DEVICE_COUNT" -eq 1 ]; then
        DEVICE_ID=$(echo "$DEVICES" | head -1)
        echo "📱 Usando dispositivo: $DEVICE_ID"
    else
        echo "📱 Múltiplos dispositivos encontrados:"
        echo "$DEVICES" | nl
        echo ""
        read -p "Digite o número do dispositivo: " DEVICE_NUM
        DEVICE_ID=$(echo "$DEVICES" | sed -n "${DEVICE_NUM}p")
    fi
fi

echo "🔍 Buscando token FCM nos logs do dispositivo $DEVICE_ID..."
echo "💡 Aguarde alguns segundos e pressione Ctrl+C quando encontrar o token"
echo ""

adb -s "$DEVICE_ID" logcat -c
adb -s "$DEVICE_ID" logcat | grep -iE "(fcmToken|Token FCM|fcm.*token)" --color=always | while read line; do
    # Tentar extrair token FCM (geralmente é uma string longa)
    TOKEN=$(echo "$line" | grep -oE '[A-Za-z0-9_-]{100,}' | head -1)
    if [ ! -z "$TOKEN" ] && [ ${#TOKEN} -gt 100 ]; then
        echo ""
        echo "✅ Token FCM encontrado:"
        echo "$TOKEN"
        echo ""
        echo "💡 Para enviar notificação, execute:"
        echo "   ./send-notification-now.sh $TOKEN"
        echo ""
    fi
    echo "$line"
done

