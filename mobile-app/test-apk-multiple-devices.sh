#!/bin/bash

echo "🚀 Testando APK em múltiplos dispositivos..."
echo "================================================"

# Verificar dispositivos conectados
echo "📱 Dispositivos conectados:"
adb devices

echo ""
echo "📦 Instalando APK em todos os dispositivos..."

# Instalar APK em todos os dispositivos
for device in $(adb devices | grep -v "List" | grep -v "daemon" | awk '{print $1}'); do
    if [ ! -z "$device" ]; then
        echo "📱 Instalando em dispositivo: $device"
        adb -s $device install -r leaf-app-latest.apk
        
        if [ $? -eq 0 ]; then
            echo "✅ APK instalado com sucesso em $device"
            
            # Abrir o app
            echo "🚀 Abrindo app em $device"
            adb -s $device shell am start -n br.com.leaf.ride/.MainActivity
            
            # Aguardar um pouco para o app inicializar
            sleep 3
            
            # Verificar se o app está rodando
            echo "🔍 Verificando se o app está rodando em $device"
            adb -s $device shell ps | grep br.com.leaf.ride
            
        else
            echo "❌ Falha ao instalar APK em $device"
        fi
        
        echo "----------------------------------------"
    fi
done

echo ""
echo "🎯 Teste de notificações em todos os dispositivos..."

# Testar notificações em todos os dispositivos
for device in $(adb devices | grep -v "List" | grep -v "daemon" | awk '{print $1}'); do
    if [ ! -z "$device" ]; then
        echo "📱 Testando notificações em: $device"
        
        # Capturar token FCM do dispositivo
        echo "🔍 Capturando token FCM..."
        adb -s $device logcat | grep -E "recordToken success token:" | head -1 &
        LOG_PID=$!
        sleep 5
        kill $LOG_PID 2>/dev/null
        
        echo "📤 Enviando notificação de teste..."
        curl -X POST http://216.238.107.59:3003/api/send-notification \
          -H "Content-Type: application/json" \
          -d '{
            "token": "fDajP2vQS-qIOINIWb3mE-:APA91bGSrfhJCxKksYiQOqk0Ypi7uGuJYK1BbZrxGGAQ4Q0lh1ce7zoYQfmGp8PqoY6W3xS9zB2xXBEMmAqEhscsoUQzcBcXUaQaHg4KUgSJPTZ8fMSqfCM",
            "title": "🎉 Teste Multi-Dispositivo",
            "body": "Notificação enviada para dispositivo: '$device'",
            "data": {
              "deviceId": "'$device'",
              "testType": "multi_device_test"
            }
          }'
        
        echo "✅ Notificação enviada para $device"
        echo "----------------------------------------"
    fi
done

echo ""
echo "🎉 Teste concluído!"
echo "📱 Verifique se as notificações apareceram em todos os dispositivos"
echo "🔍 Para ver logs detalhados: adb logcat | grep -E '(FCM|Firebase|Token|Notification|Leaf)'"


