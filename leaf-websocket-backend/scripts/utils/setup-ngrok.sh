#!/bin/bash

# Script para instalar e configurar ngrok

echo "🚀 CONFIGURANDO NGROK PARA SERVIDOR LOCAL"
echo "=========================================="
echo ""

# Cores
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() {
    echo -e "${GREEN}[OK]${NC} $1"
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

# Verificar se ngrok está instalado
if command -v ngrok &> /dev/null; then
    log "ngrok já está instalado"
    ngrok version
    echo ""
else
    warning "ngrok não está instalado"
    echo ""
    echo "📦 OPÇÕES DE INSTALAÇÃO:"
    echo ""
    echo "1. Via npm (Recomendado):"
    echo "   npm install -g ngrok"
    echo ""
    echo "2. Via Homebrew (macOS):"
    echo "   brew install ngrok"
    echo ""
    echo "3. Via Snap (Linux):"
    echo "   snap install ngrok"
    echo ""
    echo "4. Download manual:"
    echo "   https://ngrok.com/download"
    echo ""
    
    read -p "Deseja instalar via npm agora? (s/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[SsYy]$ ]]; then
        info "Instalando ngrok via npm..."
        npm install -g ngrok
        if [ $? -eq 0 ]; then
            log "ngrok instalado com sucesso!"
        else
            error "Falha ao instalar ngrok"
            exit 1
        fi
    else
        error "Por favor, instale o ngrok manualmente"
        exit 1
    fi
fi

# Verificar autenticação
echo ""
info "Verificando autenticação do ngrok..."
ngrok config check &> /dev/null

if [ $? -eq 0 ]; then
    log "ngrok está autenticado"
else
    warning "ngrok precisa de autenticação"
    echo ""
    echo "📝 PARA CONFIGURAR:"
    echo ""
    echo "1. Criar conta gratuita em: https://dashboard.ngrok.com/signup"
    echo "2. Fazer login no dashboard"
    echo "3. Copiar seu authtoken (em: https://dashboard.ngrok.com/get-started/your-authtoken)"
    echo "4. Executar: ngrok config add-authtoken SEU_TOKEN"
    echo ""
    
    read -p "Deseja configurar o authtoken agora? (s/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[SsYy]$ ]]; then
        read -p "Cole seu authtoken aqui: " authtoken
        if [ ! -z "$authtoken" ]; then
            ngrok config add-authtoken "$authtoken"
            if [ $? -eq 0 ]; then
                log "Authtoken configurado com sucesso!"
            else
                error "Falha ao configurar authtoken"
                exit 1
            fi
        else
            error "Authtoken não fornecido"
            exit 1
        fi
    else
        warning "Você precisará configurar o authtoken antes de usar o ngrok"
    fi
fi

echo ""
log "Configuração do ngrok concluída!"
echo ""
echo "📋 PRÓXIMOS PASSOS:"
echo ""
echo "1. Iniciar ngrok:"
echo "   npm run ngrok:start"
echo "   OU"
echo "   node scripts/utils/start-ngrok.js"
echo ""
echo "2. Obter URL do ngrok:"
echo "   npm run ngrok:url"
echo ""
echo "3. Configurar variável de ambiente:"
echo "   export WOOVI_WEBHOOK_URL=\"https://abc123.ngrok.io/api/woovi/webhook\""
echo ""
echo "4. Configurar webhook na Woovi Dashboard:"
echo "   https://abc123.ngrok.io/api/woovi/webhook"
echo ""

