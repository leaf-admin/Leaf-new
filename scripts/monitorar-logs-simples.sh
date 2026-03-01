#!/bin/bash

# 🔍 Monitor Simples de Logs - Versão Alternativa
# Usa método mais direto de acesso

echo "=== 🔍 MONITOR DE LOGS (SIMPLES) ==="
echo ""
echo "Monitorando eventos em tempo real..."
echo "Pressione Ctrl+C para parar"
echo ""

# Cores básicas
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Monitorar via SSH direto
ssh -o StrictHostKeyChecking=no root@216.238.107.59 << 'ENDSSH'
    cd /home/leaf/leaf-websocket-backend
    
    # Verificar qual método usar
    if [ -f server.log ]; then
        tail -f server.log
    elif command -v pm2 >/dev/null 2>&1; then
        pm2 logs server --lines 0 --raw 2>&1
    else
        echo "Tentando acessar logs do processo node..."
        ps aux | grep "node.*server.js" | grep -v grep | head -1
    fi
ENDSSH | grep --line-buffered -E "(authenticate|createBooking|QueueWorker|Dispatcher|newRideRequest|updateLocation|Motorista|Driver|test_driver|test-user-dev|booking_|corrida|notificar|error|Error|❌|✅|⚠️)" | while read line; do
    if echo "$line" | grep -qi "authenticate\|autenticado"; then
        echo -e "${GREEN}🔐 $line${NC}"
    elif echo "$line" | grep -qi "createBooking\|corrida.*criada"; then
        echo -e "${BLUE}🚗 $line${NC}"
    elif echo "$line" | grep -qi "Dispatcher\|motoristas encontrados"; then
        echo -e "${YELLOW}📢 $line${NC}"
    elif echo "$line" | grep -qi "newRideRequest\|notificado"; then
        echo -e "${GREEN}📱 $line${NC}"
    elif echo "$line" | grep -qi "error\|Error\|❌"; then
        echo -e "${RED}❌ $line${NC}"
    else
        echo "$line"
    fi
done


