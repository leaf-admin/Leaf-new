#!/bin/bash

# 🔍 Monitor de Logs do Servidor em Tempo Real
# Monitora eventos relevantes durante teste de notificação

echo "=== 🔍 MONITOR DE LOGS DO SERVIDOR ==="
echo ""
echo "Monitorando eventos relevantes..."
echo "Pressione Ctrl+C para parar"
echo ""
echo "=========================================="
echo ""

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m'

# Função para formatar logs
format_log() {
    local line="$1"
    
    # Autenticação
    if echo "$line" | grep -qE "(authenticate|autenticado|Driver.*adicionado)"; then
        echo -e "${GREEN}🔐 $line${NC}"
    # Criação de corrida
    elif echo "$line" | grep -qE "(createBooking|Solicitação de corrida|Corrida.*criada)"; then
        echo -e "${BLUE}🚗 $line${NC}"
    # QueueWorker
    elif echo "$line" | grep -qE "(QueueWorker|processando.*região|corrida.*processada)"; then
        echo -e "${CYAN}⚙️  $line${NC}"
    # DriverNotificationDispatcher
    elif echo "$line" | grep -qE "(Dispatcher|Buscando motoristas|motoristas encontrados|Score calculado)"; then
        echo -e "${MAGENTA}📢 $line${NC}"
    # Notificação enviada
    elif echo "$line" | grep -qE "(notificar|newRideRequest|emit.*driver_|Motorista.*notificado)"; then
        echo -e "${GREEN}📱 $line${NC}"
    # Erros
    elif echo "$line" | grep -qE "(❌|error|Error|ERRO|falha|Falha)"; then
        echo -e "${RED}❌ $line${NC}"
    # Avisos
    elif echo "$line" | grep -qE "(⚠️|warn|WARN|aviso)"; then
        echo -e "${YELLOW}⚠️  $line${NC}"
    # Sucesso
    elif echo "$line" | grep -qE "(✅|success|SUCCESS)"; then
        echo -e "${GREEN}✅ $line${NC}"
    # Localização
    elif echo "$line" | grep -qE "(updateLocation|Localização|Motorista.*ONLINE|saveDriverLocation)"; then
        echo -e "${CYAN}📍 $line${NC}"
    # GradualRadiusExpander
    elif echo "$line" | grep -qE "(GradualRadiusExpander|iniciando busca|raio.*expandido)"; then
        echo -e "${MAGENTA}🔍 $line${NC}"
    # Outros eventos importantes
    elif echo "$line" | grep -qE "(test_driver|test-user-dev|booking_|driver_)"; then
        echo -e "${YELLOW}🔔 $line${NC}"
    else
        echo "$line"
    fi
}

# Monitorar logs do servidor na VPS
echo -e "${BLUE}Conectando ao servidor na VPS...${NC}"
echo ""

ssh -o StrictHostKeyChecking=no root@216.238.107.59 "tail -f /home/leaf/leaf-websocket-backend/server.log 2>/dev/null || pm2 logs server --lines 0 --raw 2>&1" 2>/dev/null | while IFS= read -r line; do
    # Filtrar apenas linhas relevantes
    if echo "$line" | grep -qE "(authenticate|createBooking|QueueWorker|Dispatcher|newRideRequest|updateLocation|Motorista|Driver|test_driver|test-user-dev|booking_|corrida|notificar|error|Error|❌|✅|⚠️)"; then
        format_log "$line"
    fi
done


