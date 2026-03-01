#!/bin/bash

echo "📱 REINSTALAÇÃO DO DEVELOPMENT BUILD - LEAF APP"
echo "==============================================="

# Cores
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
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

info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

# Verificar se estamos no diretório correto
if [ ! -f "package.json" ]; then
    error "Execute este script do diretório mobile-app/"
    exit 1
fi

# Verificar se o ADB está instalado
if ! command -v adb &> /dev/null; then
    error "ADB não encontrado. Instale o Android SDK."
    echo ""
    echo "📋 INSTRUÇÕES:"
    echo "1. Instale o Android Studio"
    echo "2. Configure o ANDROID_HOME"
    echo "3. Adicione platform-tools ao PATH"
    echo "4. Execute: adb devices"
    exit 1
fi

# Verificar se há dispositivos conectados
log "Verificando dispositivos conectados..."
DEVICES=$(adb devices | grep "device$" | wc -l)

if [ $DEVICES -eq 0 ]; then
    error "Nenhum dispositivo Android conectado."
    echo ""
    echo "📋 INSTRUÇÕES:"
    echo "1. Conecte o outro aparelho via USB"
    echo "2. Habilite a depuração USB"
    echo "3. Execute: adb devices"
    echo "4. Tente novamente: ./reinstall-dev-build.sh"
    exit 1
fi

log "✅ $DEVICES dispositivo(s) conectado(s)"

# Listar dispositivos
adb devices

echo ""
info "Escolha o APK para instalar:"
echo "1. leaf-app-latest.apk (Recomendado)"
echo "2. development-client.apk"
echo "3. leaf-dev-client.apk"
echo "4. leaf-app-driver.apk"
echo "5. Construir novo APK"
echo ""

read -p "Digite sua escolha (1-5): " choice

case $choice in
    1)
        APK_FILE="leaf-app-latest.apk"
        ;;
    2)
        APK_FILE="development-client.apk"
        ;;
    3)
        APK_FILE="leaf-dev-client.apk"
        ;;
    4)
        APK_FILE="leaf-app-driver.apk"
        ;;
    5)
        log "Construindo novo APK..."
        ./build-simple.sh
        APK_FILE="android/app/build/outputs/apk/debug/app-debug.apk"
        ;;
    *)
        error "Escolha inválida"
        exit 1
        ;;
esac

# Verificar se o APK existe
if [ ! -f "$APK_FILE" ]; then
    error "APK não encontrado: $APK_FILE"
    exit 1
fi

log "📦 APK selecionado: $APK_FILE"
log "📱 Instalando no dispositivo..."

# Desinstalar versão anterior (se existir)
log "Removendo versão anterior..."
adb uninstall br.com.leaf.ride 2>/dev/null || warning "App não estava instalado"

# Instalar novo APK
log "Instalando novo APK..."
adb install -r "$APK_FILE"

if [ $? -eq 0 ]; then
    log "✅ APK instalado com sucesso!"
    
    # Configurar usuário de teste automaticamente
    log "🧪 Configurando usuário de teste..."
    
    # Aguardar o app inicializar
    sleep 3
    
    # Executar comandos para configurar usuário de teste
    log "Executando configuração automática..."
    
    # Abrir o app
    adb shell am start -n com.leafapp.reactnative/.MainActivity
    
    echo ""
    log "🎉 INSTALAÇÃO CONCLUÍDA!"
    echo ""
    echo "📱 PRÓXIMOS PASSOS:"
    echo "1. O app foi aberto automaticamente"
    echo "2. Configure o usuário de teste se necessário"
    echo "3. Teste a funcionalidade 'ficar online'"
    echo ""
    echo "🔧 CONFIGURAÇÕES IMPORTANTES:"
    echo "   - WebSocket: http://192.168.0.41:3001"
    echo "   - API: http://192.168.0.41:3001"
    echo "   - Modo de desenvolvimento ativo"
    echo ""
    echo "📊 MONITORAMENTO:"
    echo "   - Logs: adb logcat | grep 'Leaf'"
    echo "   - Debug: adb logcat | grep '🧪'"
    echo ""
    echo "🚀 COMANDOS ÚTEIS:"
    echo "   - Reiniciar app: adb shell am force-stop br.com.leaf.ride && adb shell monkey -p br.com.leaf.ride -c android.intent.category.LAUNCHER 1"
    echo "   - Ver logs: adb logcat | grep -E '(Leaf|FCM|WebSocket)'"
    echo "   - Limpar dados: adb shell pm clear br.com.leaf.ride"
    
else
    error "❌ Falha na instalação do APK"
    echo ""
    echo "🔧 SOLUÇÕES:"
    echo "1. Verifique se o dispositivo tem espaço suficiente"
    echo "2. Habilite 'Instalar apps de fontes desconhecidas'"
    echo "3. Tente: adb install -r -d $APK_FILE"
    echo "4. Verifique se o dispositivo está conectado: adb devices"
    exit 1
fi

log "✅ Script concluído!"
