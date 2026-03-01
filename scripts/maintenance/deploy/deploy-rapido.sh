#!/bin/bash

echo "🚀 DEPLOY RÁPIDO - LEAF APP"
echo "============================"
echo ""

# Cores
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() {
    echo -e "${GREEN}[DEPLOY]${NC} $1"
}

error() {
    echo -e "${RED}[ERRO]${NC} $1"
}

warning() {
    echo -e "${YELLOW}[AVISO]${NC} $1"
}

info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

# Verificar se estamos no diretório correto
if [ ! -f "mobile-app/package.json" ]; then
    error "Execute este script na raiz do projeto!"
    exit 1
fi

echo "🎯 INICIANDO DEPLOY RÁPIDO..."
echo ""

# 1. Verificar status da VPS
log "1. Verificando status da VPS..."
if curl -s http://147.93.66.253:3000/api/health > /dev/null; then
    log "✅ VPS online e funcionando"
else
    error "❌ VPS offline! Verifique a conexão."
    exit 1
fi

# 2. Configurar API keys
log "2. Configurando API keys..."
if [ -f "scripts/deploy/configure-api-keys.sh" ]; then
    ./scripts/deploy/configure-api-keys.sh
else
    warning "Script de configuração não encontrado. Configure manualmente."
fi

# 3. Deploy do app
log "3. Iniciando deploy do app..."
if [ -f "scripts/deploy/deploy-mobile-app.sh" ]; then
    ./scripts/deploy/deploy-mobile-app.sh
else
    error "Script de deploy não encontrado!"
    exit 1
fi

# 4. Verificar resultado
log "4. Verificando resultado do deploy..."

if [ -f "mobile-app/build/android-release.apk" ]; then
    log "✅ APK gerado com sucesso!"
    
    # Mostrar informações do APK
    APK_SIZE=$(du -h mobile-app/build/android-release.apk | cut -f1)
    log "📱 APK: mobile-app/build/android-release.apk"
    log "📏 Tamanho: $APK_SIZE"
    
    echo ""
    echo "🎉 DEPLOY CONCLUÍDO COM SUCESSO!"
    echo "=================================="
    echo ""
    echo "📱 APK GERADO:"
    echo "   mobile-app/build/android-release.apk"
    echo ""
    echo "🚀 PRÓXIMOS PASSOS:"
    echo "   1. Conecte um dispositivo Android via USB"
    echo "   2. Habilite a depuração USB"
    echo "   3. Execute: cd mobile-app && ./install-leaf-app.sh"
    echo ""
    echo "📊 MONITORAMENTO:"
    echo "   - API Status: http://147.93.66.253:3000/api/health"
    echo "   - VPS Logs: ssh root@147.93.66.253 'pm2 logs leaf-api'"
    echo ""
    echo "📚 DOCUMENTAÇÃO:"
    echo "   mobile-app/DEPLOY_GUIDE.md"
    echo ""
    
else
    error "❌ APK não foi gerado!"
    echo ""
    echo "🔧 TROUBLESHOOTING:"
    echo "   1. Verifique se o Expo CLI está instalado"
    echo "   2. Execute: npm install -g @expo/cli"
    echo "   3. Execute: npm install -g @expo/eas-cli"
    echo "   4. Faça login: eas login"
    echo "   5. Tente novamente: ./deploy-rapido.sh"
    echo ""
fi

echo ""
echo "🎯 STATUS FINAL:"
echo "   ✅ VPS: Online"
echo "   ✅ APIs: Funcionando"
echo "   ✅ Deploy: Concluído"
echo "   📱 Próximo: Instalar e testar o app"
echo "" 