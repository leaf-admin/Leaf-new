#!/bin/bash

echo "🔧 Diagnosticando problemas de build..."

cd mobile-app

echo "1. Verificando dependências..."
npm ls --depth=0

echo ""
echo "2. Limpando cache..."
npx expo install --fix
rm -rf node_modules
npm install --legacy-peer-deps

echo ""
echo "3. Verificando configuração do EAS..."
npx eas build:configure

echo ""
echo "4. Verificando se o projeto está configurado corretamente..."
npx expo doctor

echo ""
echo "5. Tentando build local primeiro..."
npx expo prebuild --clean

echo ""
echo "✅ Diagnóstico concluído!"
echo "Agora tente: npx eas build --platform android --profile development" 