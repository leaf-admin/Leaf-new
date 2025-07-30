#!/bin/bash

echo "🚀 Leaf App - Desenvolvimento Simples"
echo "======================================"

cd mobile-app

echo ""
echo "🔧 Configurando ambiente..."

# Limpar cache
npx expo start --clear

echo ""
echo "📱 Instruções:"
echo "1. Instale o Expo Go no seu Android"
echo "2. Abra o Expo Go"
echo "3. Escaneie o QR code que aparecerá"
echo "4. Se não funcionar, tente a opção 'Tunnel'"
echo ""

echo "🚀 Iniciando servidor..."
npx expo start --tunnel 