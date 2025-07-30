#!/bin/bash

echo "🔧 Build Android - Leaf App"
echo "============================"

cd mobile-app

echo ""
echo "1. Verificando configuração..."
npx eas whoami

echo ""
echo "2. Limpando cache..."
rm -rf node_modules
npm install --legacy-peer-deps

echo ""
echo "3. Configurando build..."
npx eas build:configure

echo ""
echo "4. Iniciando build Android..."
echo "⚠️  Isso pode demorar 10-15 minutos..."
echo "📱 O APK será enviado por email quando concluído"

npx eas build --platform android --profile development --non-interactive

echo ""
echo "✅ Build iniciada!"
echo "📧 Você receberá um email quando estiver pronta"
echo "🔗 Ou acompanhe em: https://expo.dev/accounts/leaf-app/projects/leafapp-reactnative/builds" 