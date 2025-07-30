#!/bin/bash

# 🔧 Script de Setup EAS - Leaf App
# Configura EAS Build e credenciais para CI/CD

set -e

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
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

log "🔧 Setup EAS Build - Leaf App"
echo "=============================="

# Verificar se estamos no diretório correto
if [ ! -f "package.json" ]; then
    error "Execute este script do diretório mobile-app/"
    exit 1
fi

# 1. Instalar EAS CLI
log "1. Instalando EAS CLI..."
npm install -g @expo/eas-cli

# 2. Login no Expo
log "2. Fazendo login no Expo..."
if [ -z "$EXPO_TOKEN" ]; then
    warning "⚠️  EXPO_TOKEN não encontrado!"
    echo ""
    echo "Para configurar o token:"
    echo "1. Acesse: https://expo.dev/accounts/[seu-usuario]/settings/access-tokens"
    echo "2. Crie um novo token"
    echo "3. Configure a variável EXPO_TOKEN"
    echo ""
    echo "Ou execute: eas login"
    echo ""
    read -p "Deseja fazer login manualmente? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        eas login
    else
        error "Login necessário para continuar!"
        exit 1
    fi
else
    echo "$EXPO_TOKEN" | eas login --non-interactive
fi

# 3. Configurar projeto
log "3. Configurando projeto..."
eas build:configure

# 4. Configurar credenciais Android
log "4. Configurando credenciais Android..."
eas credentials --platform android

# 5. Configurar credenciais iOS
log "5. Configurando credenciais iOS..."
warning "⚠️  Para iOS, você precisa de:"
warning "  - Conta Apple Developer ativa"
warning "  - Certificados configurados"
warning "  - Provisioning profiles"
echo ""
read -p "Deseja configurar credenciais iOS agora? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    eas credentials --platform ios
else
    warning "⚠️  Credenciais iOS não configuradas"
    warning "⚠️  Builds iOS podem falhar"
fi

# 6. Testar configuração
log "6. Testando configuração..."
eas build:list

# 7. Configurar GitHub Secrets
log "7. Configurando GitHub Secrets..."
echo ""
info "📋 Configure estes secrets no GitHub:"
echo ""
echo "EXPO_TOKEN:"
echo "  - Acesse: https://expo.dev/accounts/[seu-usuario]/settings/access-tokens"
echo "  - Crie um token e adicione como secret"
echo ""
echo "APPLE_ID:"
echo "  - Seu Apple ID para builds iOS"
echo ""
echo "APPLE_APP_SPECIFIC_PASSWORD:"
echo "  - Senha específica do app para builds iOS"
echo ""
echo "GOOGLE_SERVICE_ACCOUNT_KEY:"
echo "  - Chave JSON do Google Service Account para Play Store"
echo ""

# 8. Criar arquivo de configuração
log "8. Criando arquivo de configuração..."
cat > .easignore << 'EOF'
# Arquivos ignorados pelo EAS Build
node_modules/
.git/
.env
*.log
.DS_Store
EOF

log "✅ Setup EAS concluído!"
echo ""
info "📋 Próximos passos:"
info "1. Configure os secrets no GitHub"
info "2. Teste uma build: npx eas build --platform android --profile preview"
info "3. Configure CI/CD: git push origin main"
echo ""
info "🚀 Para fazer build:"
info "  npx eas build --platform all --profile production" 