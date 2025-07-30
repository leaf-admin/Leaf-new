#!/bin/bash

echo "🔧 SOLUÇÃO DEFINITIVA - Build Leaf App"
echo "======================================="

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# 1. Limpeza completa
log "1. Limpeza completa..."
rm -rf node_modules package-lock.json
rm -rf android ios
rm -f patches/*.patch 2>/dev/null

# 2. Reinstalação limpa
log "2. Reinstalando dependências..."
npm install --legacy-peer-deps

# 3. Remover plugins problemáticos
log "3. Removendo plugins problemáticos..."
sed -i '/react-native-sms-retriever/d' app.config.js
sed -i '/expo-build-properties/d' app.config.js

# 4. Configurar EAS
log "4. Configurando EAS..."
npx eas build:configure

# 5. Criar build simples
log "5. Criando build simples..."
npx expo prebuild --clean

# 6. Testar build local
log "6. Testando build local..."
cd android
./gradlew clean
./gradlew assembleDebug --no-daemon --stacktrace

if [ $? -eq 0 ]; then
    log "✅ Build local funcionou!"
    cd ..
    
    # 7. Tentar EAS Build
    log "7. Tentando EAS Build..."
    npx eas build --platform android --profile preview --non-interactive
    
    if [ $? -eq 0 ]; then
        log "🎉 SUCESSO! Build funcionando!"
        echo ""
        echo "📱 APK disponível em:"
        echo "https://expo.dev/accounts/leaf-app/projects/leafapp-reactnative/builds"
        echo ""
        echo "🚀 Para distribuir:"
        echo "npx eas submit --platform android"
    else
        error "❌ EAS Build falhou"
        log "💡 Tentando build de desenvolvimento..."
        npx eas build --platform android --profile development --non-interactive
    fi
else
    error "❌ Build local falhou"
    log "💡 Verificando problemas..."
    
    # Verificar licenças
    log "Aceitando licenças Android..."
    echo 'y' | sudo tee /usr/lib/android-sdk/licenses/ndk-license > /dev/null
    echo 'y' | sudo tee /usr/lib/android-sdk/licenses/ndk-side-by-side-license > /dev/null
    echo 'y' | sudo tee /usr/lib/android-sdk/licenses/android-sdk-license > /dev/null
    echo 'y' | sudo tee /usr/lib/android-sdk/licenses/android-sdk-preview-license > /dev/null
    
    log "Tentando build novamente..."
    ./gradlew assembleDebug --no-daemon --stacktrace
    
    if [ $? -eq 0 ]; then
        log "✅ Build local funcionou após aceitar licenças!"
        cd ..
        npx eas build --platform android --profile preview --non-interactive
    else
        error "❌ Build ainda falhando"
        log "💡 Criando APK manual..."
        cd ..
        npx expo export --platform android
    fi
fi

log "✅ Script concluído!" 