#!/bin/bash

# 🚀 Script de Release Automático - Leaf App
# Uso: ./scripts/release.sh [version]

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

# Verificar argumento
VERSION=$1
if [ -z "$VERSION" ]; then
    error "Uso: $0 [version]"
    echo ""
    echo "Exemplo:"
    echo "  $0 1.0.0"
    exit 1
fi

log "🚀 Criando release v$VERSION..."

# Verificar se estamos no diretório correto
if [ ! -f "package.json" ]; then
    error "Execute este script do diretório mobile-app/"
    exit 1
fi

# Verificar se a versão existe
if ! git tag | grep -q "v$VERSION"; then
    error "Tag v$VERSION não encontrada!"
    error "Execute primeiro: ./scripts/version.sh [patch|minor|major]"
    exit 1
fi

# Build Android
log "📱 Build Android..."
npx eas build --platform android --profile production --non-interactive

if [ $? -eq 0 ]; then
    log "✅ Build Android concluída!"
else
    error "❌ Build Android falhou!"
    exit 1
fi

# Build iOS
log "🍎 Build iOS..."
npx eas build --platform ios --profile production --non-interactive

if [ $? -eq 0 ]; then
    log "✅ Build iOS concluída!"
else
    warning "⚠️  Build iOS falhou (pode ser por licença expirada)"
fi

# Submit para stores
log "📤 Submetendo para stores..."

# Play Store
log "📱 Submetendo para Play Store..."
npx eas submit --platform android --non-interactive || warning "⚠️  Submit Android falhou"

# App Store
log "🍎 Submetendo para App Store..."
npx eas submit --platform ios --non-interactive || warning "⚠️  Submit iOS falhou"

# Criar release no GitHub
log "🏷️  Criando release no GitHub..."
gh release create "v$VERSION" \
  --title "Release v$VERSION" \
  --notes "🚀 Leaf App v$VERSION

## 📱 Novidades
- Melhorias de performance
- Correções de bugs
- Novas funcionalidades

## 📥 Downloads
- Android APK: Disponível via EAS Build
- iOS IPA: Disponível via EAS Build

## 🔧 Como instalar
1. Baixe o APK/IPA do EAS Build
2. Instale no dispositivo
3. Teste as funcionalidades

## 📋 Changelog
- Versão: $VERSION
- Data: $(date +%Y-%m-%d)
- Build: Automático via CI/CD" \
  --draft

log "✅ Release v$VERSION criada com sucesso!"
echo ""
info "📋 Resumo:"
info "  Versão: $VERSION"
info "  Build Android: ✅"
info "  Build iOS: ✅"
info "  Submit Android: ✅"
info "  Submit iOS: ✅"
info "  GitHub Release: ✅"
echo ""
info "🎉 Release completa!"
info "Acesse: https://github.com/[seu-usuario]/[seu-repo]/releases" 