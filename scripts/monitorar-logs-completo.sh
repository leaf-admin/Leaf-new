#!/bin/bash

# 🔍 Monitor Completo de Logs do Servidor
# Monitora TODOS os eventos relevantes com filtros inteligentes

echo "=== 🔍 MONITOR COMPLETO DE LOGS DO SERVIDOR ==="
echo ""
echo "📋 Eventos monitorados:"
echo "   - Autenticação (motorista e passageiro)"
echo "   - Criação de corrida (createBooking)"
echo "   - Processamento de filas (QueueWorker)"
echo "   - Busca de motoristas (Dispatcher)"
echo "   - Notificações (newRideRequest)"
echo "   - Localização (updateLocation)"
echo "   - Erros e avisos"
echo ""
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
WHITE='\033[1;37m'
NC='\033[0m'

# Contador de eventos
AUTH_COUNT=0
BOOKING_COUNT=0
NOTIFICATION_COUNT=0
ERROR_COUNT=0

# Função para formatar timestamp
format_timestamp() {
    date '+%H:%M:%S'
}

# Função para formatar logs
format_log() {
    local line="$1"
    local timestamp=$(format_timestamp)
    
    # Autenticação
    if echo "$line" | grep -qiE "(authenticate|autenticado|Driver.*adicionado|Customer.*adicionado)"; then
        AUTH_COUNT=$((AUTH_COUNT + 1))
        echo -e "${GREEN}[$timestamp] 🔐 AUTENTICAÇÃO:${NC} $line"
    # Criação de corrida
    elif echo "$line" | grep -qiE "(createBooking|Solicitação de corrida|Corrida.*criada|bookingCreated|Fase 7)"; then
        BOOKING_COUNT=$((BOOKING_COUNT + 1))
        echo -e "${BLUE}[$timestamp] 🚗 CORRIDA CRIADA:${NC} $line"
    # QueueWorker
    elif echo "$line" | grep -qiE "(QueueWorker|processando.*região|corrida.*processada|processNextRides)"; then
        echo -e "${CYAN}[$timestamp] ⚙️  QUEUE WORKER:${NC} $line"
    # DriverNotificationDispatcher
    elif echo "$line" | grep -qiE "(Dispatcher|Buscando motoristas|motoristas encontrados|Score calculado|findAndScoreDrivers)"; then
        echo -e "${MAGENTA}[$timestamp] 📢 DISPATCHER:${NC} $line"
    # Notificação enviada
    elif echo "$line" | grep -qiE "(notificar|newRideRequest|emit.*driver_|Motorista.*notificado|notifyDriver)"; then
        NOTIFICATION_COUNT=$((NOTIFICATION_COUNT + 1))
        echo -e "${GREEN}[$timestamp] 📱 NOTIFICAÇÃO:${NC} $line"
    # GradualRadiusExpander
    elif echo "$line" | grep -qiE "(GradualRadiusExpander|iniciando busca|raio.*expandido|startGradualSearch)"; then
        echo -e "${MAGENTA}[$timestamp] 🔍 BUSCA GRADUAL:${NC} $line"
    # Localização
    elif echo "$line" | grep -qiE "(updateLocation|Localização.*recebida|Motorista.*ONLINE|saveDriverLocation|TTL)"; then
        echo -e "${CYAN}[$timestamp] 📍 LOCALIZAÇÃO:${NC} $line"
    # Erros
    elif echo "$line" | grep -qiE "(❌|error|Error|ERRO|falha|Falha|Exception)"; then
        ERROR_COUNT=$((ERROR_COUNT + 1))
        echo -e "${RED}[$timestamp] ❌ ERRO:${NC} $line"
    # Avisos
    elif echo "$line" | grep -qiE "(⚠️|warn|WARN|aviso|Aviso)"; then
        echo -e "${YELLOW}[$timestamp] ⚠️  AVISO:${NC} $line"
    # Sucesso
    elif echo "$line" | grep -qiE "(✅|success|SUCCESS|concluído|Concluído)"; then
        echo -e "${GREEN}[$timestamp] ✅ SUCESSO:${NC} $line"
    # IDs de teste
    elif echo "$line" | grep -qiE "(test_driver|test-user-dev|test-customer|11999999999|11888888888)"; then
        echo -e "${YELLOW}[$timestamp] 🧪 TESTE:${NC} $line"
    # Booking IDs
    elif echo "$line" | grep -qiE "(booking_[0-9]|ride_[0-9])"; then
        echo -e "${BLUE}[$timestamp] 🎫 BOOKING:${NC} $line"
    # Driver IDs
    elif echo "$line" | grep -qiE "(driver_[0-9]|driver:[a-z0-9])"; then
        echo -e "${CYAN}[$timestamp] 🚗 DRIVER:${NC} $line"
    else
        # Mostrar outras linhas importantes
        if echo "$line" | grep -qiE "(Redis|GEO|fila|queue|room|socket)"; then
            echo -e "${WHITE}[$timestamp] ℹ️  INFO:${NC} $line"
        fi
    fi
}

# Função para mostrar estatísticas
show_stats() {
    echo ""
    echo "=========================================="
    echo -e "${WHITE}📊 ESTATÍSTICAS:${NC}"
    echo -e "   Autenticações: ${GREEN}$AUTH_COUNT${NC}"
    echo -e "   Corridas criadas: ${BLUE}$BOOKING_COUNT${NC}"
    echo -e "   Notificações: ${GREEN}$NOTIFICATION_COUNT${NC}"
    echo -e "   Erros: ${RED}$ERROR_COUNT${NC}"
    echo "=========================================="
}

# Trap para mostrar estatísticas ao sair
trap show_stats EXIT INT TERM

# Monitorar logs do servidor na VPS
echo -e "${BLUE}Conectando ao servidor na VPS (216.238.107.59)...${NC}"
echo ""

# Função para monitorar logs com tratamento de erros
monitor_logs() {
    ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o ServerAliveInterval=30 root@216.238.107.59 2>&1 << 'ENDSSH'
        cd /home/leaf/leaf-websocket-backend 2>/dev/null || cd /root/leaf-websocket-backend 2>/dev/null || exit 1
        
        # Método 1: Arquivo de log direto (mais confiável)
        if [ -f server.log ]; then
            tail -f server.log 2>/dev/null
        # Método 2: Tentar encontrar processo e monitorar stdout
        elif pgrep -f "node.*server.js" >/dev/null 2>&1; then
            PID=$(pgrep -f "node.*server.js" | head -1)
            if [ -n "$PID" ]; then
                # Tentar monitorar stdout/stderr do processo
                if [ -d "/proc/$PID/fd" ]; then
                    tail -f /proc/$PID/fd/1 /proc/$PID/fd/2 2>/dev/null
                else
                    echo "Processo encontrado (PID: $PID) mas não foi possível acessar logs"
                fi
            fi
        else
            echo "⚠️  Nenhum processo node encontrado rodando server.js"
            ps aux | grep "node.*server" | grep -v grep | head -3
        fi
ENDSSH
}

# Monitorar logs com tratamento de erros
monitor_logs 2>&1 | while IFS= read -r line; do
    # Ignorar linhas de erro de conexão SSH
    if echo "$line" | grep -qiE "(Connection refused|Connection timed out|Permission denied|Could not resolve)"; then
        echo -e "${RED}[ERRO DE CONEXÃO] $line${NC}" >&2
        continue
    fi
    
    # Ignorar stack traces de node (erros internos do SSH)
    if echo "$line" | grep -qiE "(at emitErrorNT|at processTicksAndRejections|at internal|node:internal)"; then
        continue
    fi
    
    # Filtrar apenas linhas relevantes
    if [ -n "$line" ] && echo "$line" | grep -qiE "(authenticate|createBooking|QueueWorker|Dispatcher|newRideRequest|updateLocation|Motorista|Driver|test_driver|test-user-dev|booking_|corrida|notificar|error|Error|❌|✅|⚠️|Redis|GEO|fila|queue|room|socket|Fase 7|GradualRadiusExpander|GradualRadius|RadiusExpansion|Servidor|WebSocket|porta)"; then
        format_log "$line"
    fi
done

