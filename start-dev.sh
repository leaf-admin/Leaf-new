#!/bin/bash

echo "🚀 Leaf App - Desenvolvimento Simples"
echo "======================================"

cd mobile-app

echo ""
echo "📱 Opções de desenvolvimento:"
echo "1. Expo Go (mais fácil - escaneie QR code)"
echo "2. Desenvolvimento web (navegador)"
echo "3. Build local (mais complexo)"
echo ""

read -p "Escolha uma opção (1-3): " choice

case $choice in
    1)
        echo "📱 Iniciando Expo Go..."
        echo "📱 Instale o Expo Go no seu Android"
        echo "📱 Escaneie o QR code que aparecerá"
        npx expo start --clear
        ;;
    2)
        echo "🌐 Iniciando desenvolvimento web..."
        npx expo start --web
        ;;
    3)
        echo "🔧 Iniciando build local..."
        echo "⚠️  Isso pode demorar e requer configuração adicional"
        npx expo run:android --device
        ;;
    *)
        echo "❌ Opção inválida"
        exit 1
        ;;
esac 