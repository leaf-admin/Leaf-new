#!/bin/bash

# Script para iniciar o sistema de monitoramento de alertas
# Uso: ./start-alert-monitor.sh [opções]

set -e

# Cores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Configurações
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MONITOR_SCRIPT="$PROJECT_DIR/monitoring/server-alert-system.js"
LOG_DIR="/var/log"
LOG_FILE="$LOG_DIR/leaf-alert-monitor.log"
PID_FILE="/var/run/leaf-alert-monitor.pid"

# Verificar se Node.js está instalado
if ! command -v node &> /dev/null; then
    echo "❌ Node.js não encontrado. Por favor, instale Node.js primeiro."
    exit 1
fi

# Verificar se o script existe
if [ ! -f "$MONITOR_SCRIPT" ]; then
    echo "❌ Script de monitoramento não encontrado: $MONITOR_SCRIPT"
    exit 1
fi

# Função para iniciar monitoramento
start_monitor() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if ps -p "$PID" > /dev/null 2>&1; then
            echo "⚠️  Monitoramento já está rodando (PID: $PID)"
            return 1
        else
            rm -f "$PID_FILE"
        fi
    fi
    
    echo "🚀 Iniciando sistema de monitoramento de alertas..."
    
    # Criar diretório de log se não existir
    mkdir -p "$LOG_DIR"
    
    # Iniciar em background
    nohup node "$MONITOR_SCRIPT" >> "$LOG_FILE" 2>&1 &
    PID=$!
    echo $PID > "$PID_FILE"
    
    sleep 2
    
    if ps -p "$PID" > /dev/null 2>&1; then
        echo -e "${GREEN}✅ Monitoramento iniciado com sucesso (PID: $PID)${NC}"
        echo "📝 Logs: $LOG_FILE"
        echo "📊 Para ver logs em tempo real: tail -f $LOG_FILE"
        return 0
    else
        echo "❌ Falha ao iniciar monitoramento"
        rm -f "$PID_FILE"
        return 1
    fi
}

# Função para parar monitoramento
stop_monitor() {
    if [ ! -f "$PID_FILE" ]; then
        echo "⚠️  Monitoramento não está rodando"
        return 1
    fi
    
    PID=$(cat "$PID_FILE")
    
    if ps -p "$PID" > /dev/null 2>&1; then
        echo "🛑 Parando monitoramento (PID: $PID)..."
        kill "$PID"
        sleep 2
        
        if ps -p "$PID" > /dev/null 2>&1; then
            echo "⚠️  Processo não parou, forçando..."
            kill -9 "$PID"
        fi
        
        rm -f "$PID_FILE"
        echo -e "${GREEN}✅ Monitoramento parado${NC}"
        return 0
    else
        echo "⚠️  Processo não encontrado"
        rm -f "$PID_FILE"
        return 1
    fi
}

# Função para status
status_monitor() {
    if [ ! -f "$PID_FILE" ]; then
        echo "❌ Monitoramento não está rodando"
        return 1
    fi
    
    PID=$(cat "$PID_FILE")
    
    if ps -p "$PID" > /dev/null 2>&1; then
        echo -e "${GREEN}✅ Monitoramento está rodando (PID: $PID)${NC}"
        echo "📝 Logs: $LOG_FILE"
        echo "📊 Últimas linhas do log:"
        tail -5 "$LOG_FILE" 2>/dev/null || echo "   (log vazio)"
        return 0
    else
        echo "❌ Processo não encontrado (PID file existe mas processo não)"
        rm -f "$PID_FILE"
        return 1
    fi
}

# Função para reiniciar
restart_monitor() {
    stop_monitor
    sleep 1
    start_monitor
}

# Menu principal
case "${1:-}" in
    start)
        start_monitor
        ;;
    stop)
        stop_monitor
        ;;
    restart)
        restart_monitor
        ;;
    status)
        status_monitor
        ;;
    *)
        echo "Uso: $0 {start|stop|restart|status}"
        echo ""
        echo "Comandos:"
        echo "  start   - Iniciar monitoramento"
        echo "  stop    - Parar monitoramento"
        echo "  restart - Reiniciar monitoramento"
        echo "  status  - Ver status do monitoramento"
        exit 1
        ;;
esac

exit $?


