#!/bin/bash
# Script para verificar status da infraestrutura de Alta Disponibilidade
# LEAF WebSocket Backend

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}📊 Status da Infraestrutura de Alta Disponibilidade${NC}\n"

# Verificar Redis Master
echo -e "${YELLOW}🔴 Redis Master:${NC}"
if docker exec leaf-redis-master redis-cli ping > /dev/null 2>&1; then
    echo -e "   ${GREEN}✅ Online${NC}"
    docker exec leaf-redis-master redis-cli info replication | grep role || true
else
    echo -e "   ${RED}❌ Offline${NC}"
fi

# Verificar Redis Replica
echo -e "\n${YELLOW}🔵 Redis Replica:${NC}"
if docker exec leaf-redis-replica redis-cli ping > /dev/null 2>&1; then
    echo -e "   ${GREEN}✅ Online${NC}"
    docker exec leaf-redis-replica redis-cli info replication | grep role || true
else
    echo -e "   ${RED}❌ Offline${NC}"
fi

# Verificar WebSocket Instances
echo -e "\n${YELLOW}🌐 WebSocket Instances:${NC}"
for i in 1 2 3; do
    echo -e "   Instance ${i} (port 300${i}):"
    if curl -s -f http://localhost:300${i}/health > /dev/null 2>&1; then
        echo -e "      ${GREEN}✅ Online${NC}"
        CONNECTIONS=$(curl -s http://localhost:300${i}/api/metrics 2>/dev/null | grep -o '"connections":[0-9]*' | cut -d: -f2 || echo "N/A")
        echo -e "      Conexões: ${CONNECTIONS}"
    else
        echo -e "      ${RED}❌ Offline${NC}"
    fi
done

# Verificar Nginx
echo -e "\n${YELLOW}⚖️  Nginx Load Balancer:${NC}"
if curl -s -f http://localhost/health > /dev/null 2>&1; then
    echo -e "   ${GREEN}✅ Online${NC}"
    echo -e "   Testando distribuição de carga:"
    for i in {1..5}; do
        RESPONSE=$(curl -s http://localhost/health 2>/dev/null | grep -o "websocket_[0-9]" || echo "N/A")
        echo -e "      Requisição ${i}: ${RESPONSE}"
    done
else
    echo -e "   ${RED}❌ Offline${NC}"
fi

# Verificar Docker Containers
echo -e "\n${YELLOW}🐳 Docker Containers:${NC}"
docker-compose -f config/docker/docker-compose-ha.yml ps 2>/dev/null || echo -e "   ${RED}❌ Docker Compose não está rodando${NC}"

# Verificar Redis Adapter
echo -e "\n${YELLOW}🔌 Socket.IO Redis Adapter:${NC}"
for i in 1 2 3; do
    LOGS=$(docker logs leaf-websocket-${i} 2>&1 | grep -i "redis adapter" | tail -1 || echo "")
    if echo "$LOGS" | grep -q "configurado"; then
        echo -e "   Instance ${i}: ${GREEN}✅ Configurado${NC}"
    else
        echo -e "   Instance ${i}: ${RED}❌ Não configurado${NC}"
    fi
done

echo -e "\n${BLUE}✅ Verificação concluída${NC}"

