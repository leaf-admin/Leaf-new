#!/bin/bash

# Script de Auto-Scaling Inteligente - Leaf System
# Monitora métricas e escala automaticamente

set -e

# Configurações
METRICS_URL="https://216.238.107.59/metrics"
LOG_FILE="/var/log/leaf-autoscale.log"
DOCKER_COMPOSE_FILE="/root/leaf-system/docker-compose-autoscaling.yml"

# Thresholds
CPU_THRESHOLD=80
MEMORY_THRESHOLD=85
CONNECTIONS_THRESHOLD=5000
RESPONSE_TIME_THRESHOLD=500

# Estado atual
CURRENT_INSTANCES=1
MAX_INSTANCES=4

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

get_metrics() {
    curl -k -s "$METRICS_URL" 2>/dev/null || echo "{}"
}

get_system_metrics() {
    # CPU Usage
    CPU_USAGE=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | sed 's/%us,//')
    
    # Memory Usage
    MEMORY_USAGE=$(free | grep Mem | awk '{printf("%.1f", $3/$2 * 100.0)}')
    
    # Active connections (aproximado via netstat)
    CONNECTIONS=$(netstat -an | grep :3001 | grep ESTABLISHED | wc -l)
    
    echo "$CPU_USAGE,$MEMORY_USAGE,$CONNECTIONS"
}

check_scaling_up() {
    local cpu=$1
    local memory=$2
    local connections=$3
    
    # Verifica se precisa escalar para cima
    if (( $(echo "$cpu > $CPU_THRESHOLD" | bc -l) )) || \
       (( $(echo "$memory > $MEMORY_THRESHOLD" | bc -l) )) || \
       (( connections > CONNECTIONS_THRESHOLD )); then
        return 0  # Precisa escalar
    fi
    return 1  # Não precisa escalar
}

check_scaling_down() {
    local cpu=$1
    local memory=$2
    local connections=$3
    
    # Verifica se pode escalar para baixo (thresholds mais baixos)
    if (( $(echo "$cpu < 30" | bc -l) )) && \
       (( $(echo "$memory < 40" | bc -l) )) && \
       (( connections < 1000 )) && \
       (( CURRENT_INSTANCES > 1 )); then
        return 0  # Pode escalar para baixo
    fi
    return 1  # Não pode escalar para baixo
}

scale_up() {
    local next_instance=$((CURRENT_INSTANCES + 1))
    
    if [ $next_instance -le $MAX_INSTANCES ]; then
        log "🚀 Escalando para cima: Iniciando instância $next_instance"
        
        # Inicia nova instância
        cd /root/leaf-system
        docker-compose -f "$DOCKER_COMPOSE_FILE" --profile scaling up websocket-$next_instance -d
        
        # Aguarda instância ficar saudável
        sleep 30
        
        # Verifica se a instância está funcionando
        if curl -k -s "http://127.0.0.1:300$next_instance/health" > /dev/null; then
            log "✅ Instância $next_instance iniciada com sucesso"
            CURRENT_INSTANCES=$next_instance
            
            # Ativa no Nginx (descomenta linha)
            sed -i "s|# server 127.0.0.1:300$next_instance|server 127.0.0.1:300$next_instance|" \
                /etc/nginx/sites-available/leaf-production
            nginx -s reload
            
            log "✅ Load balancer atualizado para $CURRENT_INSTANCES instâncias"
        else
            log "❌ Falha ao iniciar instância $next_instance"
        fi
    else
        log "⚠️ Máximo de instâncias ($MAX_INSTANCES) já atingido"
    fi
}

scale_down() {
    local instance_to_stop=$CURRENT_INSTANCES
    
    if [ $instance_to_stop -gt 1 ]; then
        log "📉 Escalando para baixo: Parando instância $instance_to_stop"
        
        # Remove do Nginx primeiro
        sed -i "s|server 127.0.0.1:300$instance_to_stop|# server 127.0.0.1:300$instance_to_stop|" \
            /etc/nginx/sites-available/leaf-production
        nginx -s reload
        
        # Aguarda conexões drainarem
        sleep 30
        
        # Para a instância
        cd /root/leaf-system
        docker-compose -f "$DOCKER_COMPOSE_FILE" stop websocket-$instance_to_stop
        
        CURRENT_INSTANCES=$((CURRENT_INSTANCES - 1))
        log "✅ Instância $instance_to_stop parada. Instâncias ativas: $CURRENT_INSTANCES"
    else
        log "⚠️ Não é possível reduzir abaixo de 1 instância"
    fi
}

# Função principal
main() {
    log "🔍 Verificando métricas para auto-scaling..."
    
    # Obtém métricas do sistema
    METRICS=$(get_system_metrics)
    CPU=$(echo "$METRICS" | cut -d',' -f1)
    MEMORY=$(echo "$METRICS" | cut -d',' -f2)
    CONNECTIONS=$(echo "$METRICS" | cut -d',' -f3)
    
    # Remove caracteres não numéricos e converte para números
    CPU=${CPU//[^0-9.]/}
    MEMORY=${MEMORY//[^0-9.]/}
    CONNECTIONS=${CONNECTIONS//[^0-9]/}
    
    log "📊 Métricas: CPU=${CPU}%, Memory=${MEMORY}%, Connections=${CONNECTIONS}, Instances=${CURRENT_INSTANCES}"
    
    # Instala bc se não estiver instalado
    if ! command -v bc &> /dev/null; then
        apt-get update && apt-get install -y bc
    fi
    
    # Verifica se precisa escalar
    if check_scaling_up "$CPU" "$MEMORY" "$CONNECTIONS"; then
        scale_up
    elif check_scaling_down "$CPU" "$MEMORY" "$CONNECTIONS"; then
        scale_down
    else
        log "✅ Métricas normais. Mantendo $CURRENT_INSTANCES instâncias"
    fi
}

# Executa apenas se for chamado diretamente
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi







