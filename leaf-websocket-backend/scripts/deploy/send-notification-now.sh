#!/bin/bash

# Script para enviar notificação de teste diretamente
# Uso: ./send-notification-now.sh [fcmToken]

USER_ID=${1:-"test-user-dev"}
API_URL="http://localhost:3001"

echo "🔔 Enviando notificação de teste..."
echo "👤 Usuário: $USER_ID"
echo ""

curl -X POST "${API_URL}/api/notifications/send" \
  -H "Authorization: Bearer test-token" \
  -H "Content-Type: application/json" \
  -d "{
    \"userIds\": [\"$USER_ID\"],
    \"title\": \"🔔 Notificação de Teste\",
    \"body\": \"Esta é uma notificação de teste do Leaf App!\",
    \"data\": {
      \"type\": \"test\",
      \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
      \"test\": true
    }
  }" | jq '.'

echo ""
echo "✅ Notificação enviada!"
echo "💡 Verifique o dispositivo - a notificação deve aparecer em alguns segundos"

