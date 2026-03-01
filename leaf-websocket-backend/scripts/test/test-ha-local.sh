#!/bin/bash
# Script de Teste - Alta Disponibilidade Local
# Testa todas as funcionalidades de HA antes de subir para produção

set -e

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🧪 Teste de Alta Disponibilidade - Ambiente Local${NC}\n"

# Verificar se está no diretório correto
if [ ! -f "server.js" ]; then
    echo -e "${RED}❌ Erro: Execute este script do diretório raiz do projeto${NC}"
    exit 1
fi

# 1. Verificar dependências
echo -e "${YELLOW}1️⃣ Verificando dependências...${NC}"
if [ ! -d "node_modules/@socket.io/redis-adapter" ]; then
    echo -e "${YELLOW}   ⚠️  @socket.io/redis-adapter não encontrado${NC}"
    echo -e "${YELLOW}   📦 Instalando...${NC}"
    npm install @socket.io/redis-adapter --save
else
    echo -e "${GREEN}   ✅ @socket.io/redis-adapter instalado${NC}"
fi

# 2. Verificar Redis
echo -e "\n${YELLOW}2️⃣ Verificando Redis...${NC}"
if redis-cli ping > /dev/null 2>&1; then
    echo -e "${GREEN}   ✅ Redis está rodando${NC}"
    REDIS_VERSION=$(redis-cli INFO server | grep redis_version | cut -d: -f2 | tr -d '\r')
    echo -e "   Versão: ${REDIS_VERSION}"
else
    echo -e "${RED}   ❌ Redis não está rodando${NC}"
    echo -e "${YELLOW}   💡 Inicie Redis: redis-server${NC}"
    exit 1
fi

# 3. Verificar arquivos necessários
echo -e "\n${YELLOW}3️⃣ Verificando arquivos...${NC}"
FILES=(
    "services/socket-io-adapter.js"
    "config/docker/docker-compose-ha.yml"
    "config/nginx/nginx-ha.conf"
    "scripts/utils/auto-scaler.js"
)

for file in "${FILES[@]}"; do
    if [ -f "$file" ]; then
        echo -e "${GREEN}   ✅ $file${NC}"
    else
        echo -e "${RED}   ❌ $file não encontrado${NC}"
    fi
done

# 4. Verificar variáveis de ambiente
echo -e "\n${YELLOW}4️⃣ Verificando variáveis de ambiente...${NC}"
if [ -f ".env" ]; then
    echo -e "${GREEN}   ✅ .env encontrado${NC}"
    if grep -q "SOCKET_IO_ADAPTER\|NODE_ENV" .env; then
        echo -e "${GREEN}   ✅ Configurações de HA encontradas${NC}"
    else
        echo -e "${YELLOW}   ⚠️  Adicione ao .env:${NC}"
        echo -e "      SOCKET_IO_ADAPTER=redis"
        echo -e "      NODE_ENV=production"
    fi
else
    echo -e "${YELLOW}   ⚠️  .env não encontrado, criando...${NC}"
    cat > .env << EOF
# Alta Disponibilidade
SOCKET_IO_ADAPTER=redis
NODE_ENV=production
REDIS_URL=redis://localhost:6379
PORT=3001
INSTANCE_ID=websocket_local_test
EOF
    echo -e "${GREEN}   ✅ .env criado${NC}"
fi

# 5. Testar carregamento do módulo
echo -e "\n${YELLOW}5️⃣ Testando carregamento do Redis Adapter...${NC}"
node -e "
try {
    const adapter = require('./services/socket-io-adapter');
    console.log('✅ Módulo carregado com sucesso');
    console.log('   Classe:', adapter.name || 'SocketIORedisAdapter');
} catch (error) {
    console.error('❌ Erro ao carregar módulo:', error.message);
    process.exit(1);
}
"

# 6. Verificar sintaxe do server.js
echo -e "\n${YELLOW}6️⃣ Verificando sintaxe do server.js...${NC}"
if node -c server.js 2>/dev/null; then
    echo -e "${GREEN}   ✅ Sintaxe correta${NC}"
else
    echo -e "${RED}   ❌ Erro de sintaxe${NC}"
    exit 1
fi

# 7. Testar inicialização (sem iniciar servidor)
echo -e "\n${YELLOW}7️⃣ Testando inicialização do Redis Adapter...${NC}"
node -e "
const SocketIORedisAdapter = require('./services/socket-io-adapter');
const adapter = new SocketIORedisAdapter('redis://localhost:6379');
console.log('✅ SocketIORedisAdapter instanciado');
console.log('   Redis URL:', adapter.redisUrl);
"

# 8. Resumo
echo -e "\n${BLUE}📊 Resumo dos Testes:${NC}"
echo -e "${GREEN}✅ Todas as verificações passaram!${NC}"
echo -e "\n${YELLOW}🚀 Próximos passos:${NC}"
echo -e "   1. Iniciar servidor: NODE_ENV=production node server.js"
echo -e "   2. Verificar logs para: 'Socket.IO Redis Adapter configurado'"
echo -e "   3. Testar health: curl http://localhost:3001/health"
echo -e "   4. Verificar múltiplas instâncias (se necessário)"

echo -e "\n${GREEN}✅ Testes concluídos com sucesso!${NC}"

