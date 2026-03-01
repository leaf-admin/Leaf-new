#!/bin/bash

# Script para parar Leaf System simples com Docker

set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🛑 PARANDO LEAF SYSTEM SIMPLES COM DOCKER${NC}"
echo "=================================================="

# Parar containers
echo -e "${YELLOW}🛑 Parando containers...${NC}"
docker stop leaf-websocket leaf-redis 2>/dev/null || true

# Remover containers
echo -e "${YELLOW}🗑️ Removendo containers...${NC}"
docker rm leaf-websocket leaf-redis 2>/dev/null || true

# Remover rede
echo -e "${YELLOW}🌐 Removendo rede...${NC}"
docker network rm leaf-network 2>/dev/null || true

echo -e "${GREEN}✅ Leaf System parado com sucesso!${NC}"
echo -e "${BLUE}🔄 Para reiniciar: ./start-simple-docker.sh${NC}"






