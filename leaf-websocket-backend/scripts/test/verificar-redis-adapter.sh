#!/bin/bash
# Script para verificar se Redis Adapter está funcionando
# Inicia servidor, captura logs e verifica configuração

# Cores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

LOG_FILE="/tmp/leaf-adapter-test.log"

echo -e "${YELLOW}🧪 Testando Redis Adapter...${NC}"

# Limpar log anterior
rm -f "$LOG_FILE"

# Iniciar servidor em background
export NODE_ENV=production
export SOCKET_IO_ADAPTER=redis
export REDIS_URL=redis://localhost:6379
export PORT=3001

echo -e "${YELLOW}🚀 Iniciando servidor...${NC}"
node server.js > "$LOG_FILE" 2>&1 &
SERVER_PID=$!

# Aguardar 15 segundos
sleep 15

# Verificar se processo ainda está rodando
if ! kill -0 $SERVER_PID 2>/dev/null; then
    echo -e "${RED}❌ Servidor parou${NC}"
    tail -30 "$LOG_FILE"
    exit 1
fi

# Verificar logs
echo -e "\n${YELLOW}📋 Verificando logs...${NC}"

if grep -q "Socket.IO Redis Adapter configurado" "$LOG_FILE"; then
    echo -e "${GREEN}✅ SUCESSO: Redis Adapter configurado!${NC}"
    SUCCESS=true
elif grep -q "Pub Client conectado\|Sub Client conectado" "$LOG_FILE"; then
    echo -e "${GREEN}✅ Redis Adapter conectado aos clientes Redis${NC}"
    SUCCESS=true
elif grep -q "Redis Adapter" "$LOG_FILE"; then
    echo -e "${YELLOW}⚠️  Redis Adapter mencionado mas não confirmado${NC}"
    grep -i "redis.*adapter" "$LOG_FILE" | tail -5
    SUCCESS=false
else
    echo -e "${RED}❌ Redis Adapter não encontrado nos logs${NC}"
    SUCCESS=false
fi

# Verificar erros
if grep -qi "erro\|error\|failed\|fail" "$LOG_FILE"; then
    echo -e "\n${YELLOW}⚠️  Erros encontrados:${NC}"
    grep -i "erro\|error\|failed\|fail" "$LOG_FILE" | grep -i "redis\|adapter" | head -5
fi

# Testar health
echo -e "\n${YELLOW}🏥 Testando health check...${NC}"
sleep 2
if curl -s http://localhost:3001/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Health check: OK${NC}"
else
    echo -e "${RED}❌ Health check: FALHOU${NC}"
fi

# Parar servidor
kill $SERVER_PID 2>/dev/null
wait $SERVER_PID 2>/dev/null

# Resumo
echo -e "\n${YELLOW}📊 Resumo:${NC}"
if [ "$SUCCESS" = true ]; then
    echo -e "${GREEN}✅ Redis Adapter: FUNCIONANDO${NC}"
    exit 0
else
    echo -e "${RED}❌ Redis Adapter: NÃO CONFIRMADO${NC}"
    echo -e "${YELLOW}📋 Log completo em: $LOG_FILE${NC}"
    exit 1
fi

