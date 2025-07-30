#!/bin/bash

echo "🔧 Configurando Ambiente Android para Leaf App"

# Verificar se o ADB está instalado
if ! command -v adb &> /dev/null; then
    echo "❌ ADB não encontrado. Instalando..."
    sudo apt update && sudo apt install -y android-tools-adb
else
    echo "✅ ADB já está instalado"
fi

# Configurar variáveis de ambiente
export ANDROID_HOME=/usr/lib/android-sdk
export PATH=$PATH:$ANDROID_HOME/tools:$ANDROID_HOME/platform-tools

echo "📱 Verificando dispositivos conectados..."
adb devices

echo ""
echo "🚀 Para conectar um dispositivo Android:"
echo "1. Ative o modo desenvolvedor no seu Android"
echo "2. Ative a depuração USB"
echo "3. Conecte via USB"
echo "4. Execute: adb devices"
echo ""
echo "📱 Para usar o emulador:"
echo "1. Abra o Android Studio"
echo "2. Vá em Tools > AVD Manager"
echo "3. Crie um novo dispositivo virtual"
echo "4. Execute: emulator -list-avds"
echo "5. Execute: emulator -avd [nome_do_avd]"
echo ""
echo "🌐 Para desenvolvimento web:"
echo "Execute: cd mobile-app && npx expo start --web"
echo ""
echo "📱 Para desenvolvimento no dispositivo:"
echo "Execute: cd mobile-app && npx expo start --dev-client"
echo ""
echo "🔗 Expo está rodando em: http://localhost:8082"
echo "📱 Escaneie o QR code ou acesse a URL acima" 