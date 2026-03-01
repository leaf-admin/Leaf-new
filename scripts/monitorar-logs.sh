#!/bin/bash

# 🔍 Monitor Simples de Logs - Versão Funcional
# Monitora diretamente o arquivo server.log na VPS

echo "=== 🔍 MONITOR DE LOGS DO SERVIDOR ==="
echo ""
echo "Conectando ao servidor na VPS..."
echo "Pressione Ctrl+C para parar"
echo ""
echo "=========================================="
echo ""

# Cores
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m'

# Função para formatar linha
format_line() {
    local line="$1"
    
    # Ignorar stack traces de erro
    if echo "$line" | grep -qiE "(at emitErrorNT|at processTicksAndRejections|at internal|node:internal)"; then
        return
    fi
    
    if echo "$line" | grep -qiE "(authenticate|autenticado|Driver.*adicionado|Customer.*adicionado)"; then
        echo -e "${GREEN}🔐 $line${NC}"
    elif echo "$line" | grep -qiE "(createBooking|Solicitação de corrida|Corrida.*criada|bookingCreated|Fase 7)"; then
        echo -e "${BLUE}🚗 $line${NC}"
    elif echo "$line" | grep -qiE "(QueueWorker|processando.*região|corrida.*processada|processNextRides)"; then
        echo -e "${CYAN}⚙️  $line${NC}"
    elif echo "$line" | grep -qiE "(Dispatcher|Buscando motoristas|motoristas encontrados|Score calculado|findAndScoreDrivers)"; then
        echo -e "${MAGENTA}📢 $line${NC}"
    elif echo "$line" | grep -qiE "(newRideRequest|notificar|Motorista.*notificado|emit.*driver_|notifyDriver)"; then
        echo -e "${GREEN}📱 $line${NC}"
    elif echo "$line" | grep -qiE "(GradualRadiusExpander|iniciando busca|raio.*expandido|startGradualSearch)"; then
        echo -e "${MAGENTA}🔍 $line${NC}"
    elif echo "$line" | grep -qiE "(updateLocation|Localização.*recebida|Motorista.*ONLINE|saveDriverLocation|TTL)"; then
        echo -e "${CYAN}📍 $line${NC}"
    elif echo "$line" | grep -qiE "(❌|error|Error|ERRO|falha|Falha|Exception)"; then
        echo -e "${RED}❌ $line${NC}"
    elif echo "$line" | grep -qiE "(⚠️|warn|WARN|aviso|Aviso)"; then
        echo -e "${YELLOW}⚠️  $line${NC}"
    elif echo "$line" | grep -qiE "(✅|success|SUCCESS|concluído|Concluído)"; then
        echo -e "${GREEN}✅ $line${NC}"
    elif echo "$line" | grep -qiE "(test_driver|test-user-dev|test-customer|11999999999|11888888888)"; then
        echo -e "${YELLOW}🧪 $line${NC}"
    elif echo "$line" | grep -qiE "(booking_[0-9]|ride_[0-9])"; then
        echo -e "${BLUE}🎫 $line${NC}"
    else
        echo "$line"
    fi
}

# Verificar conexão primeiro
echo -e "${CYAN}Verificando conexão com servidor...${NC}"
if ! ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 root@216.238.107.59 "test -f /home/leaf/leaf-websocket-backend/server.log" 2>/dev/null; then
    echo -e "${RED}❌ Erro: Não foi possível acessar o arquivo de log${NC}"
    echo -e "${YELLOW}Tentando localizar arquivo de log...${NC}"
    ssh -o StrictHostKeyChecking=no root@216.238.107.59 "find /home/leaf /root -name 'server.log' 2>/dev/null | head -1" 2>/dev/null
    exit 1
fi

echo -e "${GREEN}✅ Conectado! Monitorando logs...${NC}"
echo ""

# Monitorar logs via SSH (redirecionando stderr para ignorar erros de conexão)
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 root@216.238.107.59 "tail -f /home/leaf/leaf-websocket-backend/server.log" 2>/dev/null | while IFS= read -r line || [ -n "$line" ]; do
    # Filtrar apenas linhas relevantes e não vazias
    if [ -n "$line" ] && echo "$line" | grep -qiE "(authenticate|createBooking|QueueWorker|Dispatcher|newRideRequest|updateLocation|Motorista|Driver|test_driver|test-user-dev|booking_|corrida|notificar|error|Error|❌|✅|⚠️|Fase 7|GradualRadiusExpander|Servidor|WebSocket)"; then
        format_line "$line"
    fi
done
