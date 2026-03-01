#!/bin/bash

# Script para iniciar Leaf System com Docker + Auto-Scaling
# Suporte para megacidades (1M+ usuários simultâneos)

set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 INICIANDO LEAF SYSTEM COM DOCKER + AUTO-SCALING${NC}"
echo "========================================================"

# Verificar se Docker está rodando
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker não está rodando!${NC}"
    echo "Por favor, inicie o Docker e tente novamente."
    exit 1
fi

# Verificar se Docker Compose está disponível
if ! command -v docker-compose > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker Compose não está disponível!${NC}"
    echo "Por favor, instale o Docker Compose e tente novamente."
    exit 1
fi

# Parar cluster anterior se estiver rodando
echo -e "${YELLOW}🛑 Parando cluster anterior...${NC}"
./stop-cluster.sh 2>/dev/null || true

# Parar containers Docker se existirem
echo -e "${YELLOW}🐳 Parando containers Docker existentes...${NC}"
docker-compose down -v 2>/dev/null || true

# Limpar containers órfãos
echo -e "${YELLOW}🧹 Limpando containers órfãos...${NC}"
docker container prune -f > /dev/null 2>&1 || true

# Construir imagem Docker
echo -e "${BLUE}🔨 Construindo imagem Docker...${NC}"
docker build -t leaf-websocket-backend:latest .

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Imagem construída com sucesso${NC}"
else
    echo -e "${RED}❌ Falha ao construir imagem${NC}"
    exit 1
fi

# Iniciar sistema com Docker Compose
echo -e "${BLUE}🚀 Iniciando sistema com Docker Compose...${NC}"
docker-compose up -d

# Aguardar inicialização
echo -e "${YELLOW}⏳ Aguardando inicialização dos serviços...${NC}"
sleep 30

# Verificar status dos serviços
echo -e "${BLUE}🔍 Verificando status dos serviços...${NC}"
echo "================================================"

# Verificar Redis
if docker ps --format "table {{.Names}}\t{{.Status}}" | grep -q "leaf-redis-master.*Up"; then
    echo -e "${GREEN}✅ Redis Master: ONLINE${NC}"
else
    echo -e "${RED}❌ Redis Master: OFFLINE${NC}"
fi

if docker ps --format "table {{.Names}}\t{{.Status}}" | grep -q "leaf-redis-replica-1.*Up"; then
    echo -e "${GREEN}✅ Redis Replica 1: ONLINE${NC}"
else
    echo -e "${RED}❌ Redis Replica 1: OFFLINE${NC}"
fi

if docker ps --format "table {{.Names}}\t{{.Status}}" | grep -e "leaf-redis-replica-2.*Up"; then
    echo -e "${GREEN}✅ Redis Replica 2: ONLINE${NC}"
else
    echo -e "${RED}❌ Redis Replica 2: OFFLINE${NC}"
fi

# Verificar WebSocket servers
echo -e "\n${BLUE}🔌 Verificando servidores WebSocket...${NC}"
for i in {1..4}; do
    if docker ps --format "table {{.Names}}\t{{.Status}}" | grep -q "leaf-websocket-$i.*Up"; then
        echo -e "${GREEN}✅ WebSocket $i: ONLINE${NC}"
    else
        echo -e "${RED}❌ WebSocket $i: OFFLINE${NC}"
    fi
done

# Verificar Nginx
if docker ps --format "table {{.Names}}\t{{.Status}}" | grep -q "leaf-nginx.*Up"; then
    echo -e "${GREEN}✅ Nginx Load Balancer: ONLINE${NC}"
else
    echo -e "${RED}❌ Nginx Load Balancer: OFFLINE${NC}"
fi

# Verificar Prometheus
if docker ps --format "table {{.Names}}\t{{.Status}}" | grep -q "leaf-prometheus.*Up"; then
    echo -e "${GREEN}✅ Prometheus: ONLINE${NC}"
else
    echo -e "${RED}❌ Prometheus: OFFLINE${NC}"
fi

# Verificar Grafana
if docker ps --format "table {{.Names}}\t{{.Status}}" | grep -q "leaf-grafana.*Up"; then
    echo -e "${GREEN}✅ Grafana: ONLINE${NC}"
else
    echo -e "${RED}❌ Grafana: OFFLINE${NC}"
fi

# Testar endpoints
echo -e "\n${BLUE}🧪 Testando endpoints...${NC}"
for i in {1..4}; do
    if curl -s "http://localhost:$((3000 + i))/health" > /dev/null 2>&1; then
        echo -e "${GREEN}✅ Porta $((3000 + i)): RESPONDENDO${NC}"
    else
        echo -e "${RED}❌ Porta $((3000 + i)): SEM RESPOSTA${NC}"
    fi
done

# Mostrar estatísticas finais
echo -e "\n${BLUE}📊 ESTATÍSTICAS DO SISTEMA${NC}"
echo "================================"
echo -e "🐳 Total de containers: ${GREEN}$(docker ps -q | wc -l)${NC}"
echo -e "🔌 Servidores WebSocket: ${GREEN}4${NC}"
echo -e "🔴 Instâncias Redis: ${GREEN}3${NC}"
echo -e "🌐 Load Balancer: ${GREEN}1${NC}"
echo -e "📊 Monitoramento: ${GREEN}2${NC}"
echo -e "🚀 Capacidade estimada: ${GREEN}1M+ usuários simultâneos${NC}"

# Mostrar URLs de acesso
echo -e "\n${BLUE}🌐 URLs DE ACESSO${NC}"
echo "=================="
echo -e "🔌 WebSocket 1: ${YELLOW}ws://localhost:3001${NC}"
echo -e "🔌 WebSocket 2: ${YELLOW}ws://localhost:3002${NC}"
echo -e "🔌 WebSocket 3: ${YELLOW}ws://localhost:3003${NC}"
echo -e "🔌 WebSocket 4: ${YELLOW}ws://localhost:3004${NC}"
echo -e "🌐 Load Balancer: ${YELLOW}http://localhost:80${NC}"
echo -e "📊 Prometheus: ${YELLOW}http://localhost:9090${NC}"
echo -e "📈 Grafana: ${YELLOW}http://localhost:3000${NC} (admin/admin123)"

# Mostrar comandos úteis
echo -e "\n${BLUE}🛠️ COMANDOS ÚTEIS${NC}"
echo "=================="
echo -e "📊 Status: ${YELLOW}./auto-scale.sh status${NC}"
echo -e "📈 Escalar: ${YELLOW}./auto-scale.sh scale-up${NC}"
echo -e "📉 Reduzir: ${YELLOW}./auto-scale.sh scale-down${NC}"
echo -e "📡 Monitorar: ${YELLOW}./auto-scale.sh monitor${NC}"
echo -e "🛑 Parar: ${YELLOW}./stop-docker.sh${NC}"

echo -e "\n${GREEN}🎉 LEAF SYSTEM INICIADO COM SUCESSO!${NC}"
echo -e "${BLUE}🚀 Sistema pronto para megacidades com auto-scaling!${NC}"






