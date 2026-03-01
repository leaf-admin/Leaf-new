#!/bin/bash

# 🐳 Script de Deploy Docker para VPS
# 
# Este script faz deploy completo do Leaf App usando Docker Compose na VPS.
# Funciona tanto para primeira instalação quanto para atualizações.

set -e  # Parar em caso de erro

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configurações da VPS
VPS_USER="${VPS_USER:-root}"
VPS_IP="${VPS_IP:-147.93.66.253}"
VPS_PATH="${VPS_PATH:-/opt/leaf-app}"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo -e "${CYAN}🐳 Deploy Docker - Leaf App${NC}"
echo -e "${CYAN}==============================${NC}\n"

# Função para log
log() {
    echo -e "${GREEN}✅${NC} $1"
}

warn() {
    echo -e "${YELLOW}⚠️${NC} $1"
}

error() {
    echo -e "${RED}❌${NC} $1"
}

info() {
    echo -e "${BLUE}ℹ️${NC} $1"
}

# 1. Verificar pré-requisitos
log "Verificando pré-requisitos..."

# Verificar se está no diretório correto
if [ ! -f "$PROJECT_ROOT/leaf-websocket-backend/docker-compose.hostinger.yml" ]; then
    error "Arquivo docker-compose.hostinger.yml não encontrado!"
    exit 1
fi

# Verificar se firebase-credentials.json existe
if [ ! -f "$PROJECT_ROOT/leaf-websocket-backend/firebase-credentials.json" ]; then
    warn "firebase-credentials.json não encontrado. Será necessário copiar manualmente."
fi

# 2. Testar conexão SSH
log "Testando conexão SSH com VPS..."
if ! ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 "$VPS_USER@$VPS_IP" "echo 'Conexão OK'" > /dev/null 2>&1; then
    error "Não foi possível conectar à VPS. Verifique SSH e credenciais."
    exit 1
fi

# 3. Criar estrutura de diretórios na VPS
log "Criando estrutura de diretórios na VPS..."
ssh "$VPS_USER@$VPS_IP" "mkdir -p $VPS_PATH/{logs,ssl}"

# 4. Copiar arquivos essenciais
log "Copiando arquivos para VPS..."

# Docker Compose
scp "$PROJECT_ROOT/leaf-websocket-backend/docker-compose.hostinger.yml" "$VPS_USER@$VPS_IP:$VPS_PATH/docker-compose.yml"

# Dockerfile
scp "$PROJECT_ROOT/leaf-websocket-backend/Dockerfile" "$VPS_USER@$VPS_IP:$VPS_PATH/"

# package.json e package-lock.json
scp "$PROJECT_ROOT/leaf-websocket-backend/package.json" "$VPS_USER@$VPS_IP:$VPS_PATH/"
scp "$PROJECT_ROOT/leaf-websocket-backend/package-lock.json" "$VPS_USER@$VPS_IP:$VPS_PATH/" 2>/dev/null || warn "package-lock.json não encontrado"

# nginx.conf (se existir)
if [ -f "$PROJECT_ROOT/leaf-websocket-backend/nginx.conf" ]; then
    scp "$PROJECT_ROOT/leaf-websocket-backend/nginx.conf" "$VPS_USER@$VPS_IP:$VPS_PATH/"
fi

# firebase-credentials.json (se existir)
if [ -f "$PROJECT_ROOT/leaf-websocket-backend/firebase-credentials.json" ]; then
    scp "$PROJECT_ROOT/leaf-websocket-backend/firebase-credentials.json" "$VPS_USER@$VPS_IP:$VPS_PATH/"
    log "firebase-credentials.json copiado"
else
    warn "firebase-credentials.json não copiado (não encontrado localmente)"
fi

# 5. Criar tarball do código (excluindo node_modules e outros)
log "Criando pacote do código da aplicação..."
cd "$PROJECT_ROOT/leaf-websocket-backend"
tar --exclude='node_modules' \
    --exclude='.git' \
    --exclude='logs' \
    --exclude='coverage' \
    --exclude='*.log' \
    --exclude='.env*' \
    --exclude='firebase-credentials.json' \
    -czf /tmp/leaf-app-code.tar.gz .

# 6. Copiar código para VPS
log "Enviando código para VPS..."
scp /tmp/leaf-app-code.tar.gz "$VPS_USER@$VPS_IP:$VPS_PATH/"

# 7. Na VPS: extrair código e fazer build
log "Extraindo código e construindo imagens Docker na VPS..."
ssh "$VPS_USER@$VPS_IP" << 'ENDSSH'
    cd /opt/leaf-app
    
    # Extrair código
    tar -xzf leaf-app-code.tar.gz
    rm leaf-app-code.tar.gz
    
    # Parar containers existentes (se houver)
    docker-compose down 2>/dev/null || true
    
    # Construir imagens
    docker-compose build --no-cache
    
    # Iniciar containers
    docker-compose up -d
    
    # Aguardar alguns segundos para containers iniciarem
    sleep 10
    
    # Verificar status
    docker-compose ps
    
    # Verificar logs do websocket
    echo ""
    echo "📋 Últimas linhas dos logs do websocket:"
    docker-compose logs --tail=20 websocket
ENDSSH

# 8. Verificar saúde dos serviços
log "Verificando saúde dos serviços..."
sleep 5

# Health check
if curl -f -s "http://$VPS_IP/health" > /dev/null 2>&1; then
    log "Health check OK!"
else
    warn "Health check falhou. Verifique os logs."
fi

# 9. Limpar arquivo temporário
rm -f /tmp/leaf-app-code.tar.gz

# 10. Resumo final
echo ""
echo -e "${CYAN}📋 RESUMO DO DEPLOY:${NC}"
echo -e "${GREEN}✅${NC} Arquivos copiados para VPS"
echo -e "${GREEN}✅${NC} Imagens Docker construídas"
echo -e "${GREEN}✅${NC} Containers iniciados"
echo ""
echo -e "${CYAN}🔍 Comandos úteis:${NC}"
echo -e "  Ver logs: ${BLUE}ssh $VPS_USER@$VPS_IP 'cd $VPS_PATH && docker-compose logs -f'${NC}"
echo -e "  Status: ${BLUE}ssh $VPS_USER@$VPS_IP 'cd $VPS_PATH && docker-compose ps'${NC}"
echo -e "  Reiniciar: ${BLUE}ssh $VPS_USER@$VPS_IP 'cd $VPS_PATH && docker-compose restart'${NC}"
echo -e "  Parar: ${BLUE}ssh $VPS_USER@$VPS_IP 'cd $VPS_PATH && docker-compose down'${NC}"
echo ""
echo -e "${GREEN}🎉 Deploy concluído!${NC}"

