#!/bin/bash

# 🚀 Script de Versionamento Automático - Leaf App
# Uso: ./scripts/version.sh [patch|minor|major]

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
VERSION_TYPE=$1
if [ -z "$VERSION_TYPE" ]; then
    error "Uso: $0 [patch|minor|major]"
    echo ""
    echo "Exemplos:"
    echo "  $0 patch  # 1.0.0 -> 1.0.1"
    echo "  $0 minor  # 1.0.0 -> 1.1.0"
    echo "  $0 major  # 1.0.0 -> 2.0.0"
    exit 1
fi

# Verificar se é um tipo válido
if [[ ! "$VERSION_TYPE" =~ ^(patch|minor|major)$ ]]; then
    error "Tipo de versão inválido: $VERSION_TYPE"
    error "Use: patch, minor ou major"
    exit 1
fi

log "🚀 Iniciando versionamento..."

# Verificar se estamos no diretório correto
if [ ! -f "package.json" ]; then
    error "Execute este script do diretório mobile-app/"
    exit 1
fi

# Verificar se há mudanças não commitadas
if [ -n "$(git status --porcelain)" ]; then
    warning "⚠️  Há mudanças não commitadas!"
    echo ""
    git status --short
    echo ""
    read -p "Deseja continuar mesmo assim? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log "Versionamento cancelado."
        exit 1
    fi
fi

# Pegar versão atual
CURRENT_VERSION=$(node -p "require('./package.json').version")
log "📋 Versão atual: $CURRENT_VERSION"

# Atualizar versão no package.json
log "📝 Atualizando versão..."
npm version $VERSION_TYPE --no-git-tag-version

# Pegar nova versão
NEW_VERSION=$(node -p "require('./package.json').version")
log "📋 Nova versão: $NEW_VERSION"

# Atualizar app.config.js
log "📝 Atualizando app.config.js..."
sed -i "s/version: \".*\"/version: \"$NEW_VERSION\"/" app.config.js

# Atualizar eas.json se necessário
if [ -f "eas.json" ]; then
    log "📝 Atualizando eas.json..."
    # Aqui você pode adicionar lógica para atualizar eas.json se necessário
fi

# Commit das mudanças
log "💾 Fazendo commit das mudanças..."
git add package.json app.config.js
git commit -m "chore: bump version to $NEW_VERSION"

# Criar tag
log "🏷️  Criando tag v$NEW_VERSION..."
git tag "v$NEW_VERSION"

# Push das mudanças
log "📤 Fazendo push das mudanças..."
git push origin HEAD
git push origin "v$NEW_VERSION"

# Resumo
echo ""
log "✅ Versionamento concluído com sucesso!"
echo ""
info "📋 Resumo:"
info "  Versão anterior: $CURRENT_VERSION"
info "  Nova versão: $NEW_VERSION"
info "  Tipo: $VERSION_TYPE"
echo ""
info "🚀 Próximos passos:"
info "  1. Build automático será iniciado via GitHub Actions"
info "  2. APK/IPA serão gerados automaticamente"
info "  3. Release será criado no GitHub"
echo ""
info "📱 Para fazer build manual:"
info "  npx eas build --platform all --profile production"
echo ""
info "📤 Para submeter para stores:"
info "  npx eas submit --platform all" 