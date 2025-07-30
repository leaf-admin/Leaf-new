#!/bin/bash

echo "🚀 Leaf App - Desenvolvimento Android"
echo "======================================"

# Configurar variáveis de ambiente
export ANDROID_HOME=/usr/lib/android-sdk
export PATH=$PATH:$ANDROID_HOME/tools:$ANDROID_HOME/platform-tools

# Verificar se estamos no diretório correto
if [ ! -f "mobile-app/package.json" ]; then
    echo "❌ Execute este script no diretório raiz do projeto"
    exit 1
fi

echo ""
echo "📱 Opções de desenvolvimento:"
echo "1. Web (navegador)"
echo "2. Dispositivo físico (via USB)"
echo "3. Emulador Android"
echo "4. Verificar dispositivos"
echo "5. Abrir Android Studio"
echo ""

read -p "Escolha uma opção (1-5): " choice

case $choice in
    1)
        echo "🌐 Iniciando desenvolvimento web..."
        cd mobile-app && npx expo start --web
        ;;
    2)
        echo "📱 Iniciando para dispositivo físico..."
        echo "Certifique-se de que o dispositivo está conectado via USB"
        echo "e a depuração USB está ativada"
        adb devices
        cd mobile-app && npx expo start --dev-client
        ;;
    3)
        echo "🤖 Iniciando emulador..."
        echo "Primeiro, vamos verificar se há AVDs disponíveis:"
        emulator -list-avds
        echo ""
        echo "Se não houver AVDs, abra o Android Studio e crie um"
        echo "Depois execute: emulator -avd [nome_do_avd]"
        ;;
    4)
        echo "📱 Verificando dispositivos..."
        adb devices
        ;;
    5)
        echo "🔧 Abrindo Android Studio..."
        android-studio &
        ;;
    *)
        echo "❌ Opção inválida"
        exit 1
        ;;
esac 