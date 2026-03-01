#!/bin/bash
# Script para iniciar servidor em modo produção e testar
# LEAF WebSocket Backend

set -e

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🚀 Iniciando servidor em modo produção local${NC}\n"

# Verificar se está no diretório correto
if [ ! -f "server.js" ]; then
    echo -e "${RED}❌ Erro: Execute este script do diretório raiz do projeto${NC}"
    exit 1
fi

# Verificar Redis
if ! redis-cli ping > /dev/null 2>&1; then
    echo -e "${RED}❌ Redis não está rodando${NC}"
    echo -e "${YELLOW}💡 Inicie Redis: redis-server${NC}"
    exit 1
fi

# Verificar dependência
if [ ! -d "node_modules/@socket.io/redis-adapter" ]; then
    echo -e "${YELLOW}⚠️  @socket.io/redis-adapter não encontrado${NC}"
    echo -e "${YELLOW}💡 Tentando instalar com --no-bin-links...${NC}"
    npm install @socket.io/redis-adapter --save --no-bin-links || {
        echo -e "${RED}❌ Falha ao instalar. Instale manualmente:${NC}"
        echo -e "${GREEN}   npm install @socket.io/redis-adapter --save --no-bin-links${NC}"
        exit 1
    }
fi

# Verificar .env
if ! grep -q "SOCKET_IO_ADAPTER=redis" .env 2>/dev/null; then
    echo -e "${YELLOW}⚠️  SOCKET_IO_ADAPTER não configurado no .env${NC}"
    echo "SOCKET_IO_ADAPTER=redis" >> .env
    echo -e "${GREEN}✅ Adicionado ao .env${NC}"
fi

# Exportar variáveis
export NODE_ENV=production
export SOCKET_IO_ADAPTER=redis
export REDIS_URL=redis://localhost:6379

echo -e "${GREEN}✅ Configuração:${NC}"
echo -e "   NODE_ENV: ${NODE_ENV}"
echo -e "   SOCKET_IO_ADAPTER: ${SOCKET_IO_ADAPTER}"
echo -e "   REDIS_URL: ${REDIS_URL}"
echo ""

# Iniciar servidor
echo -e "${YELLOW}🚀 Iniciando servidor...${NC}"
echo -e "${YELLOW}💡 Procure por 'Socket.IO Redis Adapter configurado' nos logs${NC}"
echo -e "${YELLOW}💡 Pressione Ctrl+C para parar${NC}\n"

node server.js

