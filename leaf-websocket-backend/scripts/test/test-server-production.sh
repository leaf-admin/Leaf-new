#!/bin/bash
# Script para testar servidor em modo produção
# Inicia servidor, verifica logs e testa endpoints

set -e

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🧪 Testando Servidor em Modo Produção${NC}\n"

# Verificar Redis
if ! redis-cli ping > /dev/null 2>&1; then
    echo -e "${RED}❌ Redis não está rodando${NC}"
    exit 1
fi

# Verificar dependência
if [ ! -d "node_modules/@socket.io/redis-adapter" ]; then
    echo -e "${RED}❌ @socket.io/redis-adapter não instalado${NC}"
    exit 1
fi

# Configurar variáveis
export NODE_ENV=production
export SOCKET_IO_ADAPTER=redis
export REDIS_URL=redis://localhost:6379
export PORT=3001

echo -e "${GREEN}✅ Configuração:${NC}"
echo -e "   NODE_ENV: ${NODE_ENV}"
echo -e "   SOCKET_IO_ADAPTER: ${SOCKET_IO_ADAPTER}"
echo -e "   REDIS_URL: ${REDIS_URL}"
echo -e "   PORT: ${PORT}"
echo ""

# Arquivo de log temporário
LOG_FILE="/tmp/leaf-server-test.log"
rm -f "$LOG_FILE"

echo -e "${YELLOW}🚀 Iniciando servidor em background...${NC}"
node server.js > "$LOG_FILE" 2>&1 &
SERVER_PID=$!

# Aguardar servidor iniciar
echo -e "${YELLOW}⏳ Aguardando servidor iniciar (10 segundos)...${NC}"
sleep 10

# Verificar se processo ainda está rodando
if ! kill -0 $SERVER_PID 2>/dev/null; then
    echo -e "${RED}❌ Servidor parou inesperadamente${NC}"
    echo -e "${YELLOW}📋 Últimas linhas do log:${NC}"
    tail -20 "$LOG_FILE"
    exit 1
fi

echo -e "${GREEN}✅ Servidor está rodando (PID: $SERVER_PID)${NC}"

# Verificar logs para Redis Adapter
echo -e "\n${YELLOW}📋 Verificando logs...${NC}"
if grep -q "Socket.IO Redis Adapter configurado" "$LOG_FILE"; then
    echo -e "${GREEN}✅ Redis Adapter configurado com sucesso!${NC}"
else
    echo -e "${YELLOW}⚠️  Redis Adapter não encontrado nos logs${NC}"
    echo -e "${YELLOW}📋 Logs relevantes:${NC}"
    grep -i "redis\|adapter\|socket" "$LOG_FILE" | tail -10 || echo "Nenhum log relevante encontrado"
fi

# Testar health check
echo -e "\n${YELLOW}🏥 Testando health check...${NC}"
sleep 2
if curl -s -f http://localhost:3001/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Health check: OK${NC}"
    curl -s http://localhost:3001/health | head -5
else
    echo -e "${RED}❌ Health check: FALHOU${NC}"
fi

# Testar métricas
echo -e "\n${YELLOW}📊 Testando endpoint de métricas...${NC}"
if curl -s -f http://localhost:3001/api/metrics > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Métricas: OK${NC}"
else
    echo -e "${YELLOW}⚠️  Métricas: Não disponível (pode ser normal)${NC}"
fi

# Verificar conexões Redis
echo -e "\n${YELLOW}🔴 Verificando conexão Redis...${NC}"
if redis-cli ping > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Redis: Conectado${NC}"
else
    echo -e "${RED}❌ Redis: Desconectado${NC}"
fi

# Resumo
echo -e "\n${BLUE}📊 Resumo do Teste:${NC}"
echo -e "   Servidor PID: $SERVER_PID"
echo -e "   Log file: $LOG_FILE"
echo -e "   Status: ${GREEN}Rodando${NC}"

echo -e "\n${YELLOW}💡 Para parar o servidor:${NC}"
echo -e "   kill $SERVER_PID"
echo -e "   ou"
echo -e "   pkill -f 'node server.js'"

echo -e "\n${YELLOW}💡 Para ver logs em tempo real:${NC}"
echo -e "   tail -f $LOG_FILE"

echo -e "\n${GREEN}✅ Teste concluído!${NC}"

