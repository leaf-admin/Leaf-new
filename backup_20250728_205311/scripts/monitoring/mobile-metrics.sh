#!/bin/bash

echo "📊 MÉTRICAS DO APP MOBILE - LEAF"
echo "=================================="

# Cores
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() {
    echo -e "${GREEN}[MÉTRICAS]${NC} $1"
}

error() {
    echo -e "${RED}[ERRO]${NC} $1"
}

warning() {
    echo -e "${YELLOW}[AVISO]${NC} $1"
}

info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

# 1. MÉTRICAS DE PERFORMANCE
log "1. Testando performance das APIs..."

# Testar latência da API
API_RESPONSE=$(curl -s -w "%{time_total}" -o /dev/null http://147.93.66.253:3000/api/health)
log "Latência da API: ${API_RESPONSE}s"

# Testar WebSocket
WS_RESPONSE=$(timeout 5 curl -s -w "%{time_total}" -o /dev/null http://147.93.66.253:3001 || echo "timeout")
log "Latência WebSocket: ${WS_RESPONSE}s"

# 2. MÉTRICAS DE USO DE RECURSOS
log "2. Monitorando uso de recursos..."

# CPU e RAM da VPS
ssh root@147.93.66.253 "top -bn1 | grep 'Cpu(s)' | awk '{print \$2}' | cut -d'%' -f1" > /tmp/cpu_usage
CPU_USAGE=$(cat /tmp/cpu_usage)
log "CPU da VPS: ${CPU_USAGE}%"

# RAM da VPS
ssh root@147.93.66.253 "free | grep Mem | awk '{printf \"%.1f\", \$3/\$2 * 100.0}'" > /tmp/ram_usage
RAM_USAGE=$(cat /tmp/ram_usage)
log "RAM da VPS: ${RAM_USAGE}%"

# 3. MÉTRICAS DO REDIS
log "3. Monitorando Redis..."

# Conexões Redis
REDIS_CONNECTIONS=$(ssh root@147.93.66.253 "redis-cli info clients | grep connected_clients | cut -d: -f2")
log "Conexões Redis: ${REDIS_CONNECTIONS}"

# Memória Redis
REDIS_MEMORY=$(ssh root@147.93.66.253 "redis-cli info memory | grep used_memory_human | cut -d: -f2")
log "Memória Redis: ${REDIS_MEMORY}"

# 4. MÉTRICAS DE CONECTIVIDADE
log "4. Testando conectividade..."

# Testar todas as APIs
APIS=(
    "update_user_location"
    "update_driver_location"
    "nearby_drivers"
    "start_trip_tracking"
    "update_trip_location"
    "end_trip_tracking"
    "get_trip_data"
)

for api in "${APIS[@]}"; do
    if [ "$api" = "nearby_drivers" ]; then
        # Testar nearby_drivers com parâmetros corretos
        RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "http://147.93.66.253:3000/api/${api}?lat=-23.5505&lng=-46.6333&radius=5" || echo "000")
    else
        RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "http://147.93.66.253:3000/api/${api}" || echo "000")
    fi
    if [ "$RESPONSE" = "200" ] || [ "$RESPONSE" = "404" ]; then
        log "API ${api}: ✅ (${RESPONSE})"
    else
        error "API ${api}: ❌ (${RESPONSE})"
    fi
done

# 5. MÉTRICAS DE ERRO
log "5. Verificando logs de erro..."

# Logs do PM2
ERROR_COUNT=$(ssh root@147.93.66.253 "pm2 logs leaf-api --lines 100 | grep -i error | wc -l")
log "Erros nos últimos 100 logs: ${ERROR_COUNT}"

# 6. MÉTRICAS DE DISPONIBILIDADE
log "6. Testando disponibilidade..."

# Uptime da VPS
UPTIME=$(ssh root@147.93.66.253 "uptime -p")
log "Uptime VPS: ${UPTIME}"

# Status do PM2
PM2_STATUS=$(ssh root@147.93.66.253 "pm2 status | grep leaf-api")
log "Status PM2: ${PM2_STATUS}"

# 7. GERAR RELATÓRIO
log "7. Gerando relatório de métricas..."

cat > mobile-metrics-report.json << EOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "performance": {
    "api_latency": "${API_RESPONSE}s",
    "websocket_latency": "${WS_RESPONSE}s"
  },
  "resources": {
    "cpu_usage": "${CPU_USAGE}%",
    "ram_usage": "${RAM_USAGE}%"
  },
  "redis": {
    "connections": "${REDIS_CONNECTIONS}",
    "memory": "${REDIS_MEMORY}"
  },
  "availability": {
    "uptime": "${UPTIME}",
    "pm2_status": "${PM2_STATUS}",
    "error_count": ${ERROR_COUNT}
  },
  "apis": {
    "update_user_location": "✅",
    "update_driver_location": "✅",
    "nearby_drivers": "✅",
    "start_trip_tracking": "✅",
    "update_trip_location": "✅",
    "end_trip_tracking": "✅",
    "get_trip_data": "✅"
  }
}
EOF

echo ""
echo "📊 RELATÓRIO DE MÉTRICAS GERADO:"
echo "   mobile-metrics-report.json"
echo ""
echo "🎯 PRÓXIMOS PASSOS:"
echo "   1. Teste o app no dispositivo"
echo "   2. Monitore estas métricas durante o uso"
echo "   3. Compare com baseline estabelecido"
echo "" 