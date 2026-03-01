#!/bin/bash

# 🔍 Monitor de Logs via SSH - Versão Mais Robusta
# Usa método direto sem pipes complexos

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

# Conectar via SSH e monitorar logs
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 root@216.238.107.59 << 'EOF' 2>/dev/null | grep --line-buffered -iE "(authenticate|createBooking|QueueWorker|Dispatcher|newRideRequest|updateLocation|Motorista|Driver|test_driver|test-user-dev|booking_|corrida|notificar|error|Error|❌|✅|⚠️|Fase 7|GradualRadiusExpander|Servidor|WebSocket|porta)" | while IFS= read -r line; do
    cd /home/leaf/leaf-websocket-backend 2>/dev/null || cd /root/leaf-websocket-backend 2>/dev/null
    
    if [ -f server.log ]; then
        tail -f server.log
    else
        echo "⚠️  Arquivo server.log não encontrado"
        echo "Verificando processos node..."
        ps aux | grep "node.*server" | grep -v grep
    fi
EOF
    # Formatar linha
    if echo "$line" | grep -qi "authenticate\|autenticado"; then
        echo -e "${GREEN}🔐 $line${NC}"
    elif echo "$line" | grep -qi "createBooking\|corrida.*criada"; then
        echo -e "${BLUE}🚗 $line${NC}"
    elif echo "$line" | grep -qi "QueueWorker\|processando"; then
        echo -e "${CYAN}⚙️  $line${NC}"
    elif echo "$line" | grep -qi "Dispatcher\|motoristas encontrados"; then
        echo -e "${MAGENTA}📢 $line${NC}"
    elif echo "$line" | grep -qi "newRideRequest\|notificado"; then
        echo -e "${GREEN}📱 $line${NC}"
    elif echo "$line" | grep -qi "updateLocation\|ONLINE"; then
        echo -e "${CYAN}📍 $line${NC}"
    elif echo "$line" | grep -qi "error\|Error\|❌"; then
        echo -e "${RED}❌ $line${NC}"
    elif echo "$line" | grep -qi "⚠️\|warn"; then
        echo -e "${YELLOW}⚠️  $line${NC}"
    elif echo "$line" | grep -qi "✅\|success"; then
        echo -e "${GREEN}✅ $line${NC}"
    else
        echo "$line"
    fi
done


