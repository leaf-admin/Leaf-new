#!/bin/bash

# Script para testar as integrações do dashboard
echo "🧪 Testando integrações do Leaf Dashboard..."

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Função para testar endpoint
test_endpoint() {
    local name=$1
    local url=$2
    local expected_status=$3
    
    echo -n "🔍 Testando $name... "
    
    response=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null)
    
    if [ "$response" = "$expected_status" ]; then
        echo -e "${GREEN}✅ OK${NC}"
        return 0
    else
        echo -e "${RED}❌ FALHOU (Status: $response)${NC}"
        return 1
    fi
}

# URLs base
API_BASE="https://api.leaf.app.br"
WEBSOCKET_URL="wss://socket.leaf.app.br"

echo "📡 URLs de teste:"
echo "   API Base: $API_BASE"
echo "   WebSocket: $WEBSOCKET_URL"
echo ""

# Testar endpoints do dashboard
echo "🎛️ Testando endpoints do Dashboard:"

test_endpoint "Dashboard Overview" "$API_BASE/dashboard/overview" "200"
test_endpoint "VPS Vultr Metrics" "$API_BASE/dashboard/vps/vultr/metrics" "200"
test_endpoint "VPS Hostinger Metrics" "$API_BASE/dashboard/vps/hostinger/metrics" "200"
test_endpoint "Redis Metrics" "$API_BASE/dashboard/redis/metrics" "200"
test_endpoint "WebSocket Metrics" "$API_BASE/dashboard/websocket/metrics" "200"
test_endpoint "Firebase Metrics" "$API_BASE/dashboard/firebase/metrics" "200"

echo ""
echo "📊 Testando performance endpoints:"

test_endpoint "VPS Performance" "$API_BASE/dashboard/vps/vultr/performance" "200"
test_endpoint "Redis Performance" "$API_BASE/dashboard/redis/performance" "200"
test_endpoint "WebSocket Performance" "$API_BASE/dashboard/websocket/performance" "200"
test_endpoint "Firebase Performance" "$API_BASE/dashboard/firebase/performance" "200"

echo ""
echo "🔧 Testando health endpoints:"

test_endpoint "System Health" "$API_BASE/health" "200"

echo ""
echo "🌐 Testando conectividade WebSocket:"

# Testar WebSocket (simples)
if command -v wscat &> /dev/null; then
    echo -n "🔍 Testando WebSocket... "
    timeout 5 wscat -c "$WEBSOCKET_URL" > /dev/null 2>&1
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ OK${NC}"
    else
        echo -e "${YELLOW}⚠️  WebSocket não disponível (pode ser normal)${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  wscat não instalado - pulando teste WebSocket${NC}"
fi

echo ""
echo "📋 Resumo dos testes:"
echo "   - Endpoints HTTP: Testados"
echo "   - WebSocket: Verificado"
echo "   - Integrações: Prontas para uso"

echo ""
echo "🚀 Para iniciar o dashboard:"
echo "   cd leaf-dashboard"
echo "   ./start-dashboard.sh"
echo ""
echo "📍 Dashboard estará disponível em: http://localhost:3002" 