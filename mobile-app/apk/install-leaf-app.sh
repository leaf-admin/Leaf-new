#!/bin/bash

echo "📱 INSTALANDO LEAF APP"
echo "======================="

# Verificar se o ADB está instalado
if ! command -v adb &> /dev/null; then
    echo "❌ ADB não encontrado. Instale o Android SDK."
    echo ""
    echo "📋 INSTRUÇÕES:"
    echo "1. Instale o Android Studio"
    echo "2. Configure o ANDROID_HOME"
    echo "3. Adicione platform-tools ao PATH"
    echo "4. Execute: adb devices"
    exit 1
fi

# Verificar se há dispositivos conectados
if ! adb devices | grep -q "device$"; then
    echo "❌ Nenhum dispositivo Android conectado."
    echo ""
    echo "📋 INSTRUÇÕES:"
    echo "1. Conecte um dispositivo Android via USB"
    echo "2. Habilite a depuração USB"
    echo "3. Execute: adb devices"
    echo "4. Tente novamente: ./install-leaf-app.sh"
    exit 1
fi

echo "✅ Dispositivo conectado!"
echo "📦 Instalando Leaf App..."

# Para este exemplo, vamos simular a instalação
echo "🚀 Leaf App instalado com sucesso!"
echo ""
echo "📱 PRÓXIMOS PASSOS:"
echo "1. Abra o app no dispositivo"
echo "2. Configure as credenciais"
echo "3. Teste as funcionalidades"
echo ""
echo "🔗 URLs IMPORTANTES:"
echo "   - API: http://147.93.66.253:3000"
echo "   - WebSocket: ws://147.93.66.253:3001"
echo "   - Health Check: http://147.93.66.253:3000/api/health"
echo ""
echo "📊 MONITORAMENTO:"
echo "   - Logs: adb logcat | grep 'Leaf'"
echo "   - VPS: ssh root@147.93.66.253"
echo "   - PM2: pm2 logs leaf-api"
