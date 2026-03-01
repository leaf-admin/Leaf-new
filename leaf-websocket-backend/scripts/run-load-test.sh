#!/bin/bash

# Script para executar teste de carga
# Uso: ./run-load-test.sh [opções]

set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configurações padrão
WS_URL="${WS_URL:-http://localhost:3003}"
NUM_PASSENGERS="${NUM_PASSENGERS:-50}"
NUM_DRIVERS="${NUM_DRIVERS:-100}"
RIDE_CREATION_RATE="${RIDE_CREATION_RATE:-10}"
TEST_DURATION_MS="${TEST_DURATION_MS:-300000}"

echo -e "${GREEN}🚀 Teste de Carga - LEAF${NC}"
echo -e "${YELLOW}Configuração:${NC}"
echo "  - Servidor: $WS_URL"
echo "  - Passageiros: $NUM_PASSENGERS"
echo "  - Motoristas: $NUM_DRIVERS"
echo "  - Taxa de corridas: $RIDE_CREATION_RATE/s"
echo "  - Duração: $((TEST_DURATION_MS / 1000))s"
echo ""

# Verificar se Node.js está instalado
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js não encontrado. Por favor, instale Node.js primeiro.${NC}"
    exit 1
fi

# Verificar se as dependências estão instaladas
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}⚠️  Dependências não encontradas. Instalando...${NC}"
    npm install
fi

# Verificar se socket.io-client está instalado
if [ ! -d "node_modules/socket.io-client" ]; then
    echo -e "${YELLOW}⚠️  socket.io-client não encontrado. Instalando...${NC}"
    npm install socket.io-client
fi

# Verificar se axios está instalado
if [ ! -d "node_modules/axios" ]; then
    echo -e "${YELLOW}⚠️  axios não encontrado. Instalando...${NC}"
    npm install axios
fi

# Executar teste
echo -e "${GREEN}▶️  Iniciando teste de carga...${NC}"
echo ""

cd "$(dirname "$0")/.."

export WS_URL
export NUM_PASSENGERS
export NUM_DRIVERS
export RIDE_CREATION_RATE
export TEST_DURATION_MS

node scripts/load-test-production.js

echo ""
echo -e "${GREEN}✅ Teste concluído!${NC}"
echo -e "${YELLOW}📊 Verifique o relatório JSON gerado na pasta scripts/${NC}"


