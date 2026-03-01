#!/bin/bash

# Script para escalar manualmente - Leaf System
# Uso: ./scale-manual.sh [up|down] [instance_number]

set -e

NGINX_CONFIG="/etc/nginx/sites-available/leaf-production"
DOCKER_COMPOSE_FILE="/root/leaf-system/docker-compose-simple-scaling.yml"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

scale_up_instance() {
    local instance=$1
    
    log "🚀 Ativando instância $instance..."
    
    # 1. Inicia container Docker
    cd /root/leaf-system
    docker-compose -f "$DOCKER_COMPOSE_FILE" up websocket-$instance -d
    
    # 2. Aguarda container inicializar
    sleep 20
    
    # 3. Verifica se está funcionando
    if curl -k -s "http://127.0.0.1:300$instance/health" > /dev/null; then
        log "✅ Container websocket-$instance funcionando"
        
        # 4. Ativa no Nginx
        sed -i "s|# server 127.0.0.1:300$instance|server 127.0.0.1:300$instance|" "$NGINX_CONFIG"
        nginx -s reload
        
        log "✅ Instância $instance ativada no load balancer"
    else
        log "❌ Falha ao iniciar instância $instance"
        return 1
    fi
}

scale_down_instance() {
    local instance=$1
    
    log "📉 Desativando instância $instance..."
    
    # 1. Remove do Nginx
    sed -i "s|server 127.0.0.1:300$instance|# server 127.0.0.1:300$instance|" "$NGINX_CONFIG"
    nginx -s reload
    
    # 2. Aguarda conexões drainarem
    sleep 10
    
    # 3. Para container
    cd /root/leaf-system
    docker-compose -f "$DOCKER_COMPOSE_FILE" stop websocket-$instance
    
    log "✅ Instância $instance desativada"
}

show_status() {
    log "📊 Status atual das instâncias:"
    
    for i in {1..4}; do
        # Verifica container
        if docker ps | grep -q "leaf-websocket-$i"; then
            CONTAINER_STATUS="🟢 RUNNING"
        else
            CONTAINER_STATUS="🔴 STOPPED"
        fi
        
        # Verifica Nginx
        if grep -q "server 127.0.0.1:300$i" "$NGINX_CONFIG" && ! grep -q "# server 127.0.0.1:300$i" "$NGINX_CONFIG"; then
            NGINX_STATUS="🟢 ACTIVE"
        else
            NGINX_STATUS="🔴 INACTIVE"
        fi
        
        # Verifica health
        if curl -k -s "http://127.0.0.1:300$i/health" > /dev/null 2>&1; then
            HEALTH_STATUS="🟢 HEALTHY"
        else
            HEALTH_STATUS="🔴 UNHEALTHY"
        fi
        
        echo "  Instance $i: Container=$CONTAINER_STATUS | Nginx=$NGINX_STATUS | Health=$HEALTH_STATUS"
    done
}

# Menu principal
case "$1" in
    "up")
        if [ -z "$2" ]; then
            echo "Uso: $0 up <instance_number>"
            echo "Exemplo: $0 up 2"
            exit 1
        fi
        scale_up_instance "$2"
        ;;
    "down")
        if [ -z "$2" ]; then
            echo "Uso: $0 down <instance_number>"
            echo "Exemplo: $0 down 2"
            exit 1
        fi
        scale_down_instance "$2"
        ;;
    "status")
        show_status
        ;;
    "auto")
        log "🤖 Ativando auto-scaling..."
        # Copia autoscale.sh se não existir
        if [ ! -f "/root/leaf-system/autoscale.sh" ]; then
            cp autoscale.sh /root/leaf-system/
            chmod +x /root/leaf-system/autoscale.sh
        fi
        
        # Configura cron job para executar a cada 2 minutos
        (crontab -l 2>/dev/null | grep -v "autoscale.sh"; echo "*/2 * * * * /root/leaf-system/autoscale.sh") | crontab -
        log "✅ Auto-scaling configurado (executa a cada 2 minutos)"
        ;;
    *)
        echo "🚀 Script de Scaling Manual - Leaf System"
        echo ""
        echo "Uso:"
        echo "  $0 up <instance>     - Ativa instância específica (2-4)"
        echo "  $0 down <instance>   - Desativa instância específica (2-4)"
        echo "  $0 status           - Mostra status de todas instâncias"
        echo "  $0 auto             - Ativa auto-scaling automático"
        echo ""
        echo "Exemplos:"
        echo "  $0 up 2             - Ativa instância 2"
        echo "  $0 down 3           - Desativa instância 3"
        echo "  $0 status           - Status atual"
        exit 1
        ;;
esac
