#!/bin/bash
# Script de Teste - Produção Local
# Testa o servidor em modo produção localmente

set -e

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🚀 Teste de Produção Local - LEAF WebSocket Backend${NC}\n"

# Verificar se está no diretório correto
if [ ! -f "server.js" ]; then
    echo -e "${RED}❌ Erro: Execute este script do diretório raiz do projeto${NC}"
    exit 1
fi

# Verificar Redis
echo -e "${YELLOW}1️⃣ Verificando Redis...${NC}"
if redis-cli ping > /dev/null 2>&1; then
    echo -e "${GREEN}   ✅ Redis está rodando${NC}"
else
    echo -e "${RED}   ❌ Redis não está rodando${NC}"
    echo -e "${YELLOW}   💡 Inicie Redis: redis-server${NC}"
    exit 1
fi

# Configurar .env para produção local
echo -e "\n${YELLOW}2️⃣ Configurando .env para produção local...${NC}"
if [ -f ".env" ]; then
    # Backup do .env original
    cp .env .env.backup.$(date +%Y%m%d_%H%M%S)
    echo -e "${GREEN}   ✅ Backup do .env criado${NC}"
fi

# Adicionar/atualizar variáveis de produção
if ! grep -q "SOCKET_IO_ADAPTER" .env 2>/dev/null; then
    echo "" >> .env
    echo "# Alta Disponibilidade - Produção Local" >> .env
    echo "SOCKET_IO_ADAPTER=redis" >> .env
    echo -e "${GREEN}   ✅ SOCKET_IO_ADAPTER adicionado${NC}"
fi

if ! grep -q "^NODE_ENV=production" .env 2>/dev/null; then
    # Adicionar ou substituir NODE_ENV
    if grep -q "^NODE_ENV=" .env 2>/dev/null; then
        sed -i 's/^NODE_ENV=.*/NODE_ENV=production/' .env
    else
        echo "NODE_ENV=production" >> .env
    fi
    echo -e "${GREEN}   ✅ NODE_ENV=production configurado${NC}"
fi

if ! grep -q "^REDIS_URL=" .env 2>/dev/null; then
    echo "REDIS_URL=redis://localhost:6379" >> .env
    echo -e "${GREEN}   ✅ REDIS_URL adicionado${NC}"
fi

# Verificar dependência
echo -e "\n${YELLOW}3️⃣ Verificando @socket.io/redis-adapter...${NC}"
if [ -d "node_modules/@socket.io/redis-adapter" ]; then
    echo -e "${GREEN}   ✅ @socket.io/redis-adapter instalado${NC}"
else
    echo -e "${YELLOW}   ⚠️  @socket.io/redis-adapter não encontrado${NC}"
    echo -e "${YELLOW}   💡 Instale manualmente: npm install @socket.io/redis-adapter${NC}"
    echo -e "${YELLOW}   💡 Ou use: npm install --no-bin-links${NC}"
    echo -e "${YELLOW}   ⚠️  Continuando teste sem o pacote (vai falhar mas mostra se código está OK)${NC}"
fi

# Verificar sintaxe
echo -e "\n${YELLOW}4️⃣ Verificando sintaxe do código...${NC}"
if node -c server.js 2>/dev/null; then
    echo -e "${GREEN}   ✅ Sintaxe do server.js está correta${NC}"
else
    echo -e "${RED}   ❌ Erro de sintaxe no server.js${NC}"
    exit 1
fi

if node -c services/socket-io-adapter.js 2>/dev/null; then
    echo -e "${GREEN}   ✅ Sintaxe do socket-io-adapter.js está correta${NC}"
else
    echo -e "${RED}   ❌ Erro de sintaxe no socket-io-adapter.js${NC}"
    exit 1
fi

# Testar carregamento do módulo (sem inicializar)
echo -e "\n${YELLOW}5️⃣ Testando carregamento do módulo...${NC}"
node -e "
try {
    const adapter = require('./services/socket-io-adapter');
    console.log('✅ Módulo socket-io-adapter carregado');
} catch (error) {
    if (error.code === 'MODULE_NOT_FOUND' && error.message.includes('@socket.io/redis-adapter')) {
        console.log('⚠️  @socket.io/redis-adapter não instalado (esperado)');
    } else {
        console.error('❌ Erro:', error.message);
        process.exit(1);
    }
}
"

# Mostrar configuração atual
echo -e "\n${YELLOW}6️⃣ Configuração atual:${NC}"
echo -e "   SOCKET_IO_ADAPTER: $(grep SOCKET_IO_ADAPTER .env | cut -d= -f2 || echo 'não definido')"
echo -e "   NODE_ENV: $(grep '^NODE_ENV=' .env | cut -d= -f2 || echo 'não definido')"
echo -e "   REDIS_URL: $(grep '^REDIS_URL=' .env | cut -d= -f2 || echo 'não definido')"

# Instruções
echo -e "\n${BLUE}📋 Próximos passos:${NC}"
echo -e "${YELLOW}1. Instalar dependência (se necessário):${NC}"
echo -e "   ${GREEN}npm install @socket.io/redis-adapter${NC}"
echo -e "   ${GREEN}ou${NC}"
echo -e "   ${GREEN}npm install --no-bin-links${NC}"
echo -e ""
echo -e "${YELLOW}2. Iniciar servidor em modo produção:${NC}"
echo -e "   ${GREEN}NODE_ENV=production node server.js${NC}"
echo -e ""
echo -e "${YELLOW}3. Verificar logs para:${NC}"
echo -e "   ${GREEN}'✅ Socket.IO Redis Adapter configurado'${NC}"
echo -e ""
echo -e "${YELLOW}4. Testar health check:${NC}"
echo -e "   ${GREEN}curl http://localhost:3001/health${NC}"
echo -e ""
echo -e "${YELLOW}5. Verificar métricas:${NC}"
echo -e "   ${GREEN}curl http://localhost:3001/api/metrics${NC}"

echo -e "\n${GREEN}✅ Configuração concluída!${NC}"
echo -e "${YELLOW}💡 Execute o servidor e verifique os logs${NC}"

