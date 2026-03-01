#!/bin/bash

# Script simples para iniciar Leaf System com Docker
# Redis + WebSocket básico

set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 INICIANDO LEAF SYSTEM SIMPLES COM DOCKER${NC}"
echo "=================================================="

# Parar containers existentes
echo -e "${YELLOW}🛑 Parando containers existentes...${NC}"
docker stop leaf-redis leaf-websocket 2>/dev/null || true
docker rm leaf-redis leaf-websocket 2>/dev/null || true

# Criar rede
echo -e "${BLUE}🌐 Criando rede Docker...${NC}"
docker network create leaf-network 2>/dev/null || echo "Rede já existe"

# Iniciar Redis
echo -e "${BLUE}🔴 Iniciando Redis...${NC}"
docker run -d \
    --name leaf-redis \
    --network leaf-network \
    -p 6380:6379 \
    redis:7-alpine \
    redis-server --appendonly yes --maxmemory 1gb --maxmemory-policy allkeys-lru

echo -e "${GREEN}✅ Redis iniciado na porta 6380${NC}"

# Aguardar Redis inicializar
echo -e "${YELLOW}⏳ Aguardando Redis inicializar...${NC}"
sleep 5

# Verificar Redis
if docker exec leaf-redis redis-cli ping | grep -q "PONG"; then
    echo -e "${GREEN}✅ Redis respondendo corretamente${NC}"
else
    echo -e "${RED}❌ Redis não está respondendo${NC}"
    exit 1
fi

# Iniciar WebSocket
echo -e "${BLUE}🔌 Iniciando servidor WebSocket...${NC}"
docker run -d \
    --name leaf-websocket \
    --network leaf-network \
    -e NODE_ENV=production \
    -e PORT=3001 \
    -e INSTANCE_ID=websocket_1 \
    -e CLUSTER_MODE=true \
    -e REDIS_URL=redis://leaf-redis:6379 \
    -p 3001:3001 \
    leaf-websocket-backend:latest

echo -e "${GREEN}✅ WebSocket iniciado na porta 3001${NC}"

# Aguardar WebSocket inicializar
echo -e "${YELLOW}⏳ Aguardando WebSocket inicializar...${NC}"
sleep 15

# Verificar WebSocket
echo -e "${BLUE}🧪 Testando endpoint de health...${NC}"
if curl -s http://localhost:3001/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅ WebSocket respondendo corretamente${NC}"
else
    echo -e "${RED}❌ WebSocket não está respondendo${NC}"
    echo -e "${YELLOW}📋 Logs do WebSocket:${NC}"
    docker logs leaf-websocket --tail 20
    exit 1
fi

# Mostrar status final
echo -e "\n${BLUE}📊 STATUS DO SISTEMA${NC}"
echo "====================="
echo -e "🔴 Redis: ${GREEN}ONLINE${NC} (porta 6380)"
echo -e "🔌 WebSocket: ${GREEN}ONLINE${NC} (porta 3001)"
echo -e "🌐 Rede: ${GREEN}leaf-network${NC}"

echo -e "\n${BLUE}🌐 URLs DE ACESSO${NC}"
echo "=================="
echo -e "🔌 WebSocket: ${YELLOW}ws://localhost:3001${NC}"
echo -e "🌐 Health: ${YELLOW}http://localhost:3001/health${NC}"
echo -e "🔴 Redis: ${YELLOW}localhost:6380${NC}"

echo -e "\n${BLUE}🛠️ COMANDOS ÚTEIS${NC}"
echo "=================="
echo -e "📊 Status: ${YELLOW}docker ps${NC}"
echo -e "📋 Logs Redis: ${YELLOW}docker logs leaf-redis${NC}"
echo -e "📋 Logs WebSocket: ${YELLOW}docker logs leaf-websocket${NC}"
echo -e "🛑 Parar: ${YELLOW}./stop-simple-docker.sh${NC}"

echo -e "\n${GREEN}🎉 LEAF SYSTEM INICIADO COM SUCESSO!${NC}"
echo -e "${BLUE}🚀 Sistema básico funcionando!${NC}"






