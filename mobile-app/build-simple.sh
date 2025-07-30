#!/bin/bash

echo "🚀 BUILD SIMPLES - Leaf App"
echo "==========================="

# Cores
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

log() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 1. Limpeza
log "1. Limpando..."
rm -rf android ios
rm -rf node_modules package-lock.json

# 2. Reinstalação
log "2. Reinstalando dependências..."
npm install --legacy-peer-deps

# 3. Prebuild
log "3. Criando build..."
npx expo prebuild --clean

# 4. Configurar SDK
log "4. Configurando Android SDK..."
echo "sdk.dir=/usr/lib/android-sdk" > android/local.properties

# 5. Aceitar licenças
log "5. Aceitando licenças..."
echo 'y' | sudo tee /usr/lib/android-sdk/licenses/ndk-license > /dev/null
echo 'y' | sudo tee /usr/lib/android-sdk/licenses/ndk-side-by-side-license > /dev/null
echo 'y' | sudo tee /usr/lib/android-sdk/licenses/android-sdk-license > /dev/null
echo 'y' | sudo tee /usr/lib/android-sdk/licenses/android-sdk-preview-license > /dev/null

# 6. Build
log "6. Fazendo build..."
cd android
./gradlew clean
./gradlew assembleDebug --no-daemon

if [ $? -eq 0 ]; then
    log "✅ SUCESSO! APK criado!"
    echo ""
    echo "📱 APK disponível em:"
    echo "app/build/outputs/apk/debug/app-debug.apk"
    echo ""
    echo "🚀 Para instalar no dispositivo:"
    echo "adb install app/build/outputs/apk/debug/app-debug.apk"
    echo ""
    echo "📤 Para distribuir via EAS:"
    echo "cd .. && npx eas build --platform android --profile production"
else
    error "❌ Build falhou"
    log "💡 Tentando build sem NDK..."
    ./gradlew assembleDebug --no-daemon -Pandroid.enableJetifier=true
fi

log "✅ Script concluído!" 