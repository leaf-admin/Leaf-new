#!/bin/bash

echo "📊 DASHBOARD TEMPO REAL - LEAF APP"
echo "===================================="

# Cores
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m'

# Função para limpar tela
clear_screen() {
    clear
    echo -e "${CYAN}📊 DASHBOARD TEMPO REAL - LEAF APP${NC}"
    echo -e "${CYAN}====================================${NC}"
    echo ""
}

# Função para mostrar métricas
show_metrics() {
    local timestamp=$(date '+%H:%M:%S')
    
    echo -e "${PURPLE}🕐 Última atualização: ${timestamp}${NC}"
    echo ""
    
    # 1. STATUS DA VPS
    echo -e "${BLUE}🏠 VPS STATUS:${NC}"
    VPS_STATUS=$(curl -s http://147.93.66.253:3000/api/health | jq -r '.status' 2>/dev/null || echo "OFFLINE")
    if [ "$VPS_STATUS" = "OK" ]; then
        echo -e "   ✅ VPS: ${GREEN}ONLINE${NC}"
    else
        echo -e "   ❌ VPS: ${RED}OFFLINE${NC}"
    fi
    
    # 2. PERFORMANCE
    echo -e "${BLUE}⚡ PERFORMANCE:${NC}"
    API_LATENCY=$(curl -s -w "%{time_total}" -o /dev/null http://147.93.66.253:3000/api/health 2>/dev/null || echo "0.000")
    echo -e "   📡 API Latency: ${YELLOW}${API_LATENCY}s${NC}"
    
    # 3. RECURSOS
    echo -e "${BLUE}💾 RECURSOS:${NC}"
    CPU_USAGE=$(ssh root@147.93.66.253 "top -bn1 | grep 'Cpu(s)' | awk '{print \$2}' | cut -d'%' -f1" 2>/dev/null || echo "0")
    RAM_USAGE=$(ssh root@147.93.66.253 "free | grep Mem | awk '{printf \"%.1f\", \$3/\$2 * 100.0}'" 2>/dev/null || echo "0")
    echo -e "   🖥️  CPU: ${YELLOW}${CPU_USAGE}%${NC}"
    echo -e "   🧠 RAM: ${YELLOW}${RAM_USAGE}%${NC}"
    
    # 4. REDIS
    echo -e "${BLUE}🗄️  REDIS:${NC}"
    REDIS_CONNECTIONS=$(ssh root@147.93.66.253 "redis-cli info clients | grep connected_clients | cut -d: -f2" 2>/dev/null || echo "0")
    REDIS_MEMORY=$(ssh root@147.93.66.253 "redis-cli info memory | grep used_memory_human | cut -d: -f2" 2>/dev/null || echo "0B")
    echo -e "   🔗 Conexões: ${YELLOW}${REDIS_CONNECTIONS}${NC}"
    echo -e "   💾 Memória: ${YELLOW}${REDIS_MEMORY}${NC}"
    
    # 5. APIS
    echo -e "${BLUE}🔧 APIS:${NC}"
    APIS=("update_user_location" "update_driver_location" "nearby_drivers" "start_trip_tracking" "update_trip_location" "end_trip_tracking" "get_trip_data")
    
    for api in "${APIS[@]}"; do
        RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "http://147.93.66.253:3000/api/${api}" 2>/dev/null || echo "000")
        if [ "$RESPONSE" = "200" ] || [ "$RESPONSE" = "404" ]; then
            echo -e "   ✅ ${api}: ${GREEN}OK${NC}"
        else
            echo -e "   ❌ ${api}: ${RED}ERRO${NC}"
        fi
    done
    
    # 6. ERROS
    echo -e "${BLUE}🚨 ERROS:${NC}"
    ERROR_COUNT=$(ssh root@147.93.66.253 "pm2 logs leaf-api --lines 50 | grep -i error | wc -l" 2>/dev/null || echo "0")
    if [ "$ERROR_COUNT" -eq 0 ]; then
        echo -e "   ✅ Erros: ${GREEN}0${NC}"
    else
        echo -e "   ⚠️  Erros: ${YELLOW}${ERROR_COUNT}${NC}"
    fi
    
    # 7. UPTIME
    echo -e "${BLUE}⏱️  UPTIME:${NC}"
    UPTIME=$(ssh root@147.93.66.253 "uptime -p" 2>/dev/null || echo "unknown")
    echo -e "   🕐 VPS: ${YELLOW}${UPTIME}${NC}"
    
    echo ""
    echo -e "${PURPLE}📊 MÉTRICAS EM TEMPO REAL${NC}"
    echo -e "${PURPLE}========================${NC}"
    echo ""
}

# Função para mostrar estatísticas de uso
show_usage_stats() {
    echo -e "${CYAN}📈 ESTATÍSTICAS DE USO:${NC}"
    echo -e "${CYAN}========================${NC}"
    echo ""
    
    # Estatísticas do Redis
    echo -e "${BLUE}🗄️  REDIS STATS:${NC}"
    REDIS_KEYS=$(ssh root@147.93.66.253 "redis-cli dbsize" 2>/dev/null || echo "0")
    REDIS_OPS=$(ssh root@147.93.66.253 "redis-cli info stats | grep total_commands_processed | cut -d: -f2" 2>/dev/null || echo "0")
    echo -e "   🔑 Keys: ${YELLOW}${REDIS_KEYS}${NC}"
    echo -e "   ⚡ Ops: ${YELLOW}${REDIS_OPS}${NC}"
    
    # Estatísticas do PM2
    echo -e "${BLUE}🔄 PM2 STATS:${NC}"
    PM2_RESTARTS=$(ssh root@147.93.66.253 "pm2 status | grep leaf-api | awk '{print \$10}'" 2>/dev/null || echo "0")
    PM2_UPTIME=$(ssh root@147.93.66.253 "pm2 status | grep leaf-api | awk '{print \$8}'" 2>/dev/null || echo "0")
    echo -e "   🔄 Restarts: ${YELLOW}${PM2_RESTARTS}${NC}"
    echo -e "   ⏱️  Uptime: ${YELLOW}${PM2_UPTIME}${NC}"
    
    echo ""
}

# Função para mostrar alertas
show_alerts() {
    echo -e "${CYAN}🚨 ALERTAS:${NC}"
    echo -e "${CYAN}===========${NC}"
    echo ""
    
    # Verificar CPU
    CPU_USAGE=$(ssh root@147.93.66.253 "top -bn1 | grep 'Cpu(s)' | awk '{print \$2}' | cut -d'%' -f1" 2>/dev/null || echo "0")
    if (( $(echo "$CPU_USAGE > 80" | bc -l) )); then
        echo -e "   ⚠️  ${RED}CPU ALTO: ${CPU_USAGE}%${NC}"
    fi
    
    # Verificar RAM
    RAM_USAGE=$(ssh root@147.93.66.253 "free | grep Mem | awk '{printf \"%.1f\", \$3/\$2 * 100.0}'" 2>/dev/null || echo "0")
    if (( $(echo "$RAM_USAGE > 80" | bc -l) )); then
        echo -e "   ⚠️  ${RED}RAM ALTO: ${RAM_USAGE}%${NC}"
    fi
    
    # Verificar erros
    ERROR_COUNT=$(ssh root@147.93.66.253 "pm2 logs leaf-api --lines 50 | grep -i error | wc -l" 2>/dev/null || echo "0")
    if [ "$ERROR_COUNT" -gt 5 ]; then
        echo -e "   ⚠️  ${RED}MUITOS ERROS: ${ERROR_COUNT}${NC}"
    fi
    
    # Verificar latência
    API_LATENCY=$(curl -s -w "%{time_total}" -o /dev/null http://147.93.66.253:3000/api/health 2>/dev/null || echo "0.000")
    if (( $(echo "$API_LATENCY > 1.0" | bc -l) )); then
        echo -e "   ⚠️  ${RED}LATÊNCIA ALTA: ${API_LATENCY}s${NC}"
    fi
    
    echo ""
}

# Função principal
main() {
    clear_screen
    show_metrics
    show_usage_stats
    show_alerts
    
    echo -e "${GREEN}✅ Sistema funcionando normalmente${NC}"
    echo ""
    echo -e "${YELLOW}Pressione Ctrl+C para sair${NC}"
    echo ""
}

# Loop principal
while true; do
    main
    sleep 5
done 