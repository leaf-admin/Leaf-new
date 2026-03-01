#!/bin/bash
# Script de Deploy - Alta Disponibilidade
# LEAF WebSocket Backend

set -e

echo "🚀 Iniciando deploy de Alta Disponibilidade..."

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Verificar se está no diretório correto
if [ ! -f "server.js" ]; then
    echo -e "${RED}❌ Erro: Execute este script do diretório raiz do projeto${NC}"
    exit 1
fi

# Verificar se Docker está instalado
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker não está instalado${NC}"
    exit 1
fi

# Verificar se Docker Compose está instalado
if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}❌ Docker Compose não está instalado${NC}"
    exit 1
fi

# Verificar dependências
echo -e "${YELLOW}📦 Verificando dependências...${NC}"
if [ ! -d "node_modules/@socket.io/redis-adapter" ]; then
    echo -e "${YELLOW}⚠️  @socket.io/redis-adapter não encontrado, instalando...${NC}"
    npm install @socket.io/redis-adapter --save
fi

# Parar instâncias atuais (se existirem)
echo -e "${YELLOW}🛑 Parando instâncias atuais...${NC}"
docker-compose down 2>/dev/null || true
docker-compose -f config/docker/docker-compose-ha.yml down 2>/dev/null || true

# Construir imagens
echo -e "${YELLOW}🔨 Construindo imagens Docker...${NC}"
docker-compose -f config/docker/docker-compose-ha.yml build

# Iniciar serviços
echo -e "${YELLOW}🚀 Iniciando serviços de Alta Disponibilidade...${NC}"
docker-compose -f config/docker/docker-compose-ha.yml up -d

# Aguardar serviços iniciarem
echo -e "${YELLOW}⏳ Aguardando serviços iniciarem (30 segundos)...${NC}"
sleep 30

# Verificar health checks
echo -e "${YELLOW}🏥 Verificando health checks...${NC}"

# Verificar Redis Master
if docker exec leaf-redis-master redis-cli ping > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Redis Master: OK${NC}"
else
    echo -e "${RED}❌ Redis Master: FALHOU${NC}"
fi

# Verificar Redis Replica
if docker exec leaf-redis-replica redis-cli ping > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Redis Replica: OK${NC}"
else
    echo -e "${RED}❌ Redis Replica: FALHOU${NC}"
fi

# Verificar WebSocket instances
for i in 1 2 3; do
    if curl -f http://localhost:300${i}/health > /dev/null 2>&1; then
        echo -e "${GREEN}✅ WebSocket Instance ${i}: OK${NC}"
    else
        echo -e "${RED}❌ WebSocket Instance ${i}: FALHOU${NC}"
    fi
done

# Verificar Nginx
if curl -f http://localhost/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Nginx Load Balancer: OK${NC}"
else
    echo -e "${RED}❌ Nginx Load Balancer: FALHOU${NC}"
fi

# Mostrar status
echo -e "\n${YELLOW}📊 Status dos serviços:${NC}"
docker-compose -f config/docker/docker-compose-ha.yml ps

echo -e "\n${GREEN}✅ Deploy concluído!${NC}"
echo -e "${YELLOW}📝 Próximos passos:${NC}"
echo -e "   1. Verificar logs: docker-compose -f config/docker/docker-compose-ha.yml logs -f"
echo -e "   2. Testar load balancing: curl http://localhost/health"
echo -e "   3. Monitorar métricas: http://localhost:3001/api/metrics"

