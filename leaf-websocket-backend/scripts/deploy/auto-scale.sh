#!/bin/bash

# Script de Auto-Scaling para Leaf WebSocket Backend
# Suporte para megacidades (1M+ usuários simultâneos)

set -e

# Configurações
MAX_INSTANCES=8
MIN_INSTANCES=4
SCALE_UP_THRESHOLD=80
SCALE_DOWN_THRESHOLD=30
CHECK_INTERVAL=30

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 INICIANDO AUTO-SCALING DO LEAF SYSTEM${NC}"
echo "================================================"

# Função para obter métricas de carga
get_load_metrics() {
    local total_cpu=0
    local total_memory=0
    local active_instances=0
    
    # Verificar containers ativos
    for i in {1..8}; do
        if docker ps --format "table {{.Names}}" | grep -q "leaf-websocket-$i"; then
            active_instances=$((active_instances + 1))
            
            # Obter métricas do container
            local container_name="leaf-websocket-$i"
            if docker stats --no-stream --format "table {{.CPUPerc}}\t{{.MemPerc}}" "$container_name" > /dev/null 2>&1; then
                local stats=$(docker stats --no-stream --format "table {{.CPUPerc}}\t{{.MemPerc}}" "$container_name" | tail -1)
                local cpu_perc=$(echo "$stats" | awk '{print $1}' | sed 's/%//')
                local mem_perc=$(echo "$stats" | awk '{print $2}' | sed 's/%//')
                
                total_cpu=$(echo "$total_cpu + $cpu_perc" | bc -l)
                total_memory=$(echo "$total_memory + $mem_perc" | bc -l)
            fi
        fi
    done
    
    if [ $active_instances -gt 0 ]; then
        local avg_cpu=$(echo "scale=1; $total_cpu / $active_instances" | bc -l)
        local avg_memory=$(echo "scale=1; $total_memory / $active_instances" | bc -l)
        
        echo "$active_instances:$avg_cpu:$avg_memory"
    else
        echo "0:0:0"
    fi
}

# Função para escalar para cima
scale_up() {
    local current_instances=$1
    local new_instance=$((current_instances + 1))
    
    if [ $new_instance -le $MAX_INSTANCES ]; then
        echo -e "${YELLOW}📈 ESCALANDO PARA CIMA: Instância $new_instance${NC}"
        
        # Criar novo container
        docker run -d \
            --name "leaf-websocket-$new_instance" \
            --network leaf-websocket-backend_leaf-network \
            -e NODE_ENV=production \
            -e PORT=$((3000 + new_instance)) \
            -e INSTANCE_ID="websocket_$new_instance" \
            -e CLUSTER_MODE=true \
            -e REDIS_URL=redis://redis-master:6379 \
            -p $((3000 + new_instance)):$((3000 + new_instance)) \
            --restart unless-stopped \
            leaf-websocket-backend_websocket-1:latest
        
        echo -e "${GREEN}✅ Nova instância $new_instance criada com sucesso${NC}"
        
        # Aguardar inicialização
        sleep 10
        
        # Verificar se está funcionando
        if curl -s "http://localhost:$((3000 + new_instance))/health" > /dev/null 2>&1; then
            echo -e "${GREEN}✅ Instância $new_instance está funcionando${NC}"
        else
            echo -e "${RED}❌ Falha na instância $new_instance${NC}"
        fi
    else
        echo -e "${RED}❌ Máximo de instâncias atingido ($MAX_INSTANCES)${NC}"
    fi
}

# Função para escalar para baixo
scale_down() {
    local current_instances=$1
    local remove_instance=$current_instances
    
    if [ $remove_instance -gt $MIN_INSTANCES ]; then
        echo -e "${YELLOW}📉 ESCALANDO PARA BAIXO: Removendo instância $remove_instance${NC}"
        
        # Parar e remover container
        docker stop "leaf-websocket-$remove_instance" 2>/dev/null || true
        docker rm "leaf-websocket-$remove_instance" 2>/dev/null || true
        
        echo -e "${GREEN}✅ Instância $remove_instance removida com sucesso${NC}"
    else
        echo -e "${RED}❌ Mínimo de instâncias atingido ($MIN_INSTANCES)${NC}"
    fi
}

# Função para mostrar status
show_status() {
    echo -e "\n${BLUE}📊 STATUS ATUAL DO SISTEMA${NC}"
    echo "================================"
    
    local metrics=$(get_load_metrics)
    local instances=$(echo "$metrics" | cut -d: -f1)
    local avg_cpu=$(echo "$metrics" | cut -d: -f2)
    local avg_memory=$(echo "$metrics" | cut -d: -f3)
    
    echo -e "🔌 Instâncias ativas: ${GREEN}$instances${NC}"
    echo -e "🖥️ CPU médio: ${YELLOW}${avg_cpu}%${NC}"
    echo -e "💾 Memória média: ${YELLOW}${avg_memory}%${NC}"
    echo -e "📈 Limite para escalar: ${YELLOW}${SCALE_UP_THRESHOLD}%${NC}"
    echo -e "📉 Limite para reduzir: ${YELLOW}${SCALE_DOWN_THRESHOLD}%${NC}"
    
    # Mostrar containers ativos
    echo -e "\n${BLUE}🐳 CONTAINERS ATIVOS:${NC}"
    docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep "leaf-websocket"
}

# Função principal de auto-scaling
auto_scale() {
    echo -e "\n${BLUE}🔄 EXECUTANDO AUTO-SCALING${NC}"
    echo "================================"
    
    local metrics=$(get_load_metrics)
    local instances=$(echo "$metrics" | cut -d: -f1)
    local avg_cpu=$(echo "$metrics" | cut -d: -f2)
    local avg_memory=$(echo "$metrics" | cut -d: -f3)
    
    # Verificar se precisa escalar para cima
    if (( $(echo "$avg_cpu > $SCALE_UP_THRESHOLD" | bc -l) )) || (( $(echo "$avg_memory > $SCALE_UP_THRESHOLD" | bc -l) )); then
        echo -e "${YELLOW}⚠️ ALTA CARGA DETECTADA!${NC}"
        echo -e "   CPU: ${avg_cpu}% > ${SCALE_UP_THRESHOLD}%"
        echo -e "   Memória: ${avg_memory}% > ${SCALE_UP_THRESHOLD}%"
        scale_up $instances
    # Verificar se pode escalar para baixo
    elif (( $(echo "$avg_cpu < $SCALE_DOWN_THRESHOLD" | bc -l) )) && (( $(echo "$avg_memory < $SCALE_DOWN_THRESHOLD" | bc -l) )); then
        echo -e "${GREEN}✅ CARGA BAIXA DETECTADA${NC}"
        echo -e "   CPU: ${avg_cpu}% < ${SCALE_DOWN_THRESHOLD}%"
        echo -e "   Memória: ${avg_memory}% < ${SCALE_DOWN_THRESHOLD}%"
        scale_down $instances
    else
        echo -e "${GREEN}✅ CARGA NORMAL - Nenhuma ação necessária${NC}"
    fi
}

# Função para monitoramento contínuo
monitor() {
    echo -e "${BLUE}📡 INICIANDO MONITORAMENTO CONTÍNUO${NC}"
    echo "================================================"
    echo -e "Intervalo de verificação: ${YELLOW}${CHECK_INTERVAL}s${NC}"
    echo -e "Pressione Ctrl+C para parar"
    
    while true; do
        show_status
        auto_scale
        echo -e "\n${BLUE}⏳ Aguardando próxima verificação...${NC}"
        sleep $CHECK_INTERVAL
    done
}

# Menu principal
case "${1:-monitor}" in
    "status")
        show_status
        ;;
    "scale-up")
        local current=$(get_load_metrics | cut -d: -f1)
        scale_up $current
        ;;
    "scale-down")
        local current=$(get_load_metrics | cut -d: -f1)
        scale_down $current
        ;;
    "monitor"|*)
        monitor
        ;;
esac






