#!/bin/bash

# 🐳 Script de Setup Docker Local
# 
# Este script configura e testa o ambiente Docker localmente
# antes de fazer deploy na VPS.

set -e

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${CYAN}🐳 Setup Docker Local - Leaf App${NC}"
echo -e "${CYAN}================================${NC}\n"

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

# 1. Verificar Docker
log "Verificando Docker..."
if ! command -v docker &> /dev/null; then
    error "Docker não está instalado!"
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    error "Docker Compose não está instalado!"
    exit 1
fi

log "Docker e Docker Compose encontrados"

# 2. Verificar arquivos necessários
log "Verificando arquivos necessários..."

if [ ! -f "docker-compose.local.yml" ]; then
    error "docker-compose.local.yml não encontrado!"
    exit 1
fi

if [ ! -f "Dockerfile" ]; then
    error "Dockerfile não encontrado!"
    exit 1
fi

if [ ! -f "package.json" ]; then
    error "package.json não encontrado!"
    exit 1
fi

log "Arquivos necessários encontrados"

# 3. Parar containers existentes
info "Parando containers existentes (se houver)..."
docker-compose -f docker-compose.local.yml down 2>/dev/null || true

# 4. Construir imagens
log "Construindo imagens Docker..."
docker-compose -f docker-compose.local.yml build --no-cache

# 5. Iniciar containers
log "Iniciando containers..."
docker-compose -f docker-compose.local.yml up -d

# 6. Aguardar serviços iniciarem
info "Aguardando serviços iniciarem (15 segundos)..."
sleep 15

# 7. Verificar saúde dos serviços
log "Verificando saúde dos serviços..."

# Redis
if docker-compose -f docker-compose.local.yml exec -T redis redis-cli -a leaf_redis_2024 ping > /dev/null 2>&1; then
    log "Redis: OK"
else
    error "Redis: FALHOU"
fi

# WebSocket
if curl -f http://localhost:3001/health > /dev/null 2>&1; then
    log "WebSocket: OK"
    info "Health check: $(curl -s http://localhost:3001/health | jq -r '.status' 2>/dev/null || echo 'OK')"
else
    error "WebSocket: FALHOU"
    warn "Verificando logs..."
    docker-compose -f docker-compose.local.yml logs --tail=20 websocket
fi

# 8. Mostrar status
echo ""
log "Status dos containers:"
docker-compose -f docker-compose.local.yml ps

# 9. Mostrar comandos úteis
echo ""
echo -e "${CYAN}📋 Comandos úteis:${NC}"
echo -e "  Ver logs: ${BLUE}docker-compose -f docker-compose.local.yml logs -f${NC}"
echo -e "  Parar: ${BLUE}docker-compose -f docker-compose.local.yml down${NC}"
echo -e "  Reiniciar: ${BLUE}docker-compose -f docker-compose.local.yml restart${NC}"
echo -e "  Testar Redis: ${BLUE}docker-compose -f docker-compose.local.yml exec redis redis-cli -a leaf_redis_2024 ping${NC}"
echo ""

echo -e "${GREEN}🎉 Setup concluído!${NC}"

