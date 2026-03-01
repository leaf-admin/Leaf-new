#!/bin/bash

# 🔍 Monitor Direto de Logs - Versão Mais Simples e Robusta
# Acessa logs diretamente via SSH sem pipes complexos

echo "=== 🔍 MONITOR DE LOGS (DIRETO) ==="
echo ""
echo "Monitorando eventos em tempo real..."
echo "Pressione Ctrl+C para parar"
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
    
    if echo "$line" | grep -qiE "(authenticate|autenticado|Driver.*adicionado)"; then
        echo -e "${GREEN}🔐 $line${NC}"
    elif echo "$line" | grep -qiE "(createBooking|Solicitação de corrida|Corrida.*criada|Fase 7)"; then
        echo -e "${BLUE}🚗 $line${NC}"
    elif echo "$line" | grep -qiE "(QueueWorker|processando.*região|corrida.*processada)"; then
        echo -e "${CYAN}⚙️  $line${NC}"
    elif echo "$line" | grep -qiE "(Dispatcher|Buscando motoristas|motoristas encontrados|Score calculado)"; then
        echo -e "${MAGENTA}📢 $line${NC}"
    elif echo "$line" | grep -qiE "(newRideRequest|notificar|Motorista.*notificado|emit.*driver_)"; then
        echo -e "${GREEN}📱 $line${NC}"
    elif echo "$line" | grep -qiE "(GradualRadiusExpander|iniciando busca|raio.*expandido)"; then
        echo -e "${MAGENTA}🔍 $line${NC}"
    elif echo "$line" | grep -qiE "(updateLocation|Localização.*recebida|Motorista.*ONLINE|saveDriverLocation|TTL)"; then
        echo -e "${CYAN}📍 $line${NC}"
    elif echo "$line" | grep -qiE "(❌|error|Error|ERRO|falha|Exception)"; then
        echo -e "${RED}❌ $line${NC}"
    elif echo "$line" | grep -qiE "(⚠️|warn|WARN|aviso)"; then
        echo -e "${YELLOW}⚠️  $line${NC}"
    elif echo "$line" | grep -qiE "(✅|success|SUCCESS|concluído)"; then
        echo -e "${GREEN}✅ $line${NC}"
    else
        echo "$line"
    fi
}

# Conectar e monitorar
echo -e "${BLUE}Conectando ao servidor...${NC}"
echo ""

ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 root@216.238.107.59 "cd /home/leaf/leaf-websocket-backend 2>/dev/null || cd /root/leaf-websocket-backend 2>/dev/null; if [ -f server.log ]; then tail -f server.log; else echo 'Arquivo server.log não encontrado. Verificando processos...'; ps aux | grep 'node.*server' | grep -v grep | head -3; fi" 2>&1 | grep --line-buffered -E "(authenticate|createBooking|QueueWorker|Dispatcher|newRideRequest|updateLocation|Motorista|Driver|test_driver|test-user-dev|booking_|corrida|notificar|error|Error|❌|✅|⚠️|Fase 7|GradualRadiusExpander|Servidor|WebSocket)" | while read line; do
    format_line "$line"
done


