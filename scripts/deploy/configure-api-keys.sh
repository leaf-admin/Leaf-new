#!/bin/bash

echo "🔑 CONFIGURANDO API KEYS - LEAF APP"
echo "===================================="

# Cores
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() {
    echo -e "${GREEN}[CONFIG]${NC} $1"
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

cd mobile-app

# Verificar se .env.production existe
if [ ! -f ".env.production" ]; then
    error ".env.production não encontrado! Execute deploy-mobile-app.sh primeiro."
    exit 1
fi

echo ""
echo "🔑 CONFIGURAÇÃO DE API KEYS"
echo "============================"
echo ""
echo "⚠️  IMPORTANTE: Configure as chaves abaixo antes de fazer o deploy!"
echo ""

# Google Maps API Key
echo "🗺️  GOOGLE MAPS API KEY:"
echo "   - Acesse: https://console.cloud.google.com/"
echo "   - Crie um projeto ou use existente"
echo "   - Ative Maps SDK for Android"
echo "   - Crie uma chave de API"
echo "   - Exemplo: AIzaSyBxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
echo ""

# Firebase
echo "🔥 FIREBASE CONFIG:"
echo "   - Acesse: https://console.firebase.google.com/"
echo "   - Selecione o projeto: leaf-app-91dfdce0"
echo "   - Vá em Project Settings > General"
echo "   - Copie as configurações"
echo ""

# Woovi
echo "💰 WOOVI API KEY:"
echo "   - Acesse: https://app.woovi.com/"
echo "   - Vá em Configurações > API"
echo "   - Gere uma nova chave"
echo ""

# MercadoPago
echo "💳 MERCADOPAGO:"
echo "   - Acesse: https://www.mercadopago.com.br/developers"
echo "   - Crie uma conta de desenvolvedor"
echo "   - Gere as chaves de teste e produção"
echo ""

echo "📝 EDITANDO .env.production..."
echo ""

# Backup do arquivo original
cp .env.production .env.production.backup

# Criar template para edição
cat > .env.production.template << 'EOF'
# API URLs
API_BASE_URL=http://147.93.66.253:3000
WEBSOCKET_URL=ws://147.93.66.253:3001
FIREBASE_FALLBACK_URL=https://us-central1-leaf-app-91dfdce0.cloudfunctions.net

# API Keys
GOOGLE_MAPS_API_KEY=YOUR_GOOGLE_MAPS_API_KEY_HERE
MAPBOX_API_KEY=pk.eyJ1IjoibGVhZi1hcHAiLCJhIjoiY205MHJxazByMGlybzJrcTIyZ25wdm1maSJ9.aX1wTUINIhk_nsQAACNnyA
LOCATIONIQ_API_KEY=pk.59262794905b7196e5a09bf1fd47911d

# Firebase (OBRIGATÓRIO)
FIREBASE_API_KEY=YOUR_FIREBASE_API_KEY_HERE
FIREBASE_AUTH_DOMAIN=leaf-app-91dfdce0.firebaseapp.com
FIREBASE_PROJECT_ID=leaf-app-91dfdce0
FIREBASE_STORAGE_BUCKET=leaf-app-91dfdce0.appspot.com
FIREBASE_MESSAGING_SENDER_ID=YOUR_SENDER_ID_HERE
FIREBASE_APP_ID=YOUR_APP_ID_HERE

# Woovi (OBRIGATÓRIO)
WOOVI_API_KEY=YOUR_WOOVI_API_KEY_HERE

# MercadoPago (OBRIGATÓRIO)
MERCADOPAGO_PUBLIC_KEY=YOUR_MERCADOPAGO_PUBLIC_KEY_HERE
MERCADOPAGO_ACCESS_TOKEN=YOUR_MERCADOPAGO_ACCESS_TOKEN_HERE

# Environment
NODE_ENV=production
EXPO_PUBLIC_ENV=production
EOF

# Abrir editor para configurar
if command -v nano &> /dev/null; then
    log "Abrindo editor para configurar API keys..."
    nano .env.production.template
elif command -v vim &> /dev/null; then
    log "Abrindo editor para configurar API keys..."
    vim .env.production.template
else
    warning "Editor não encontrado. Configure manualmente o arquivo .env.production.template"
fi

# Verificar se as chaves foram configuradas
if grep -q "YOUR_" .env.production.template; then
    warning "Algumas chaves ainda não foram configuradas!"
    echo ""
    echo "❌ CHAVES PENDENTES:"
    grep "YOUR_" .env.production.template
    echo ""
    echo "⚠️  Configure todas as chaves antes de fazer o deploy!"
else
    log "Todas as chaves configuradas!"
    
    # Substituir arquivo original
    mv .env.production.template .env.production
    
    echo ""
    echo "✅ CONFIGURAÇÃO CONCLUÍDA!"
    echo "=========================="
    echo ""
    echo "🚀 PRÓXIMO PASSO:"
    echo "   Execute: ./scripts/deploy/deploy-mobile-app.sh"
    echo ""
    echo "📱 DEPLOY:"
    echo "   cd mobile-app"
    echo "   ./deploy-mobile-app.sh"
    echo ""
    echo "📋 TESTE:"
    echo "   ./install-leaf-app.sh"
fi

cd ..

echo ""
echo "🎯 RESUMO:"
echo "   ✅ Template criado: mobile-app/.env.production.template"
echo "   ✅ Backup salvo: mobile-app/.env.production.backup"
echo "   ⚠️  Configure as chaves antes do deploy!"
echo "" 