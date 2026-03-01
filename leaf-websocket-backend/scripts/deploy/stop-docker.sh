#!/bin/bash

# Script para parar Leaf System com Docker

set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🛑 PARANDO LEAF SYSTEM COM DOCKER${NC}"
echo "=========================================="

# Parar cluster anterior se estiver rodando
echo -e "${YELLOW}🛑 Parando cluster anterior...${NC}"
./stop-cluster.sh 2>/dev/null || true

# Parar containers Docker
echo -e "${YELLOW}🐳 Parando containers Docker...${NC}"
docker-compose down -v

# Remover containers órfãos
echo -e "${YELLOW}🧹 Removendo containers órfãos...${NC}"
docker container prune -f > /dev/null 2>&1 || true

# Remover imagens não utilizadas
echo -e "${YELLOW}🗑️ Removendo imagens não utilizadas...${NC}"
docker image prune -f > /dev/null 2>&1 || true

# Remover volumes não utilizados
echo -e "${YELLOW}💾 Removendo volumes não utilizados...${NC}"
docker volume prune -f > /dev/null 2>&1 || true

# Remover redes não utilizadas
echo -e "${YELLOW}🌐 Removendo redes não utilizadas...${NC}"
docker network prune -f > /dev/null 2>&1 || true

echo -e "${GREEN}✅ Leaf System parado com sucesso!${NC}"
echo -e "${BLUE}🔄 Para reiniciar: ./start-docker.sh${NC}"






