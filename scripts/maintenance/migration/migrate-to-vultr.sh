#!/bin/bash

# 🚀 SCRIPT DE MIGRAÇÃO PARA VULTR
# Data: 29 de Julho de 2025
# Autor: Leaf App Team

set -e

echo "🚀 INICIANDO MIGRAÇÃO PARA VULTR..."

# Verificar se está rodando como root
if [ "$EUID" -ne 0 ]; then
    echo "❌ Este script deve ser executado como root (sudo)"
    exit 1
fi

# Configurações
HOSTINGER_IP="147.93.66.253"
VULTR_IP="VULTR_IP"  # Será substituído pelo IP da Vultr
APP_USER="leaf"
APP_DIR="/home/$APP_USER"

echo "📋 Verificando conectividade..."
if ! ping -c 1 $HOSTINGER_IP > /dev/null 2>&1; then
    echo "❌ Hostinger não está acessível"
    exit 1
fi

echo "📦 Instalando dependências..."
apt install -y rsync sshpass

# Função de backup dos dados
backup_hostinger_data() {
    echo "🔄 Fazendo backup dos dados da Hostinger..."
    
    # Criar backup do Redis da Hostinger
    echo "📦 Backup do Redis..."
    ssh $APP_USER@$HOSTINGER_IP "redis-cli BGSAVE"
    sleep 10
    
    # Copiar dados do Redis
    rsync -avz $APP_USER@$HOSTINGER_IP:/var/lib/redis/dump.rdb /tmp/hostinger-redis.rdb
    
    # Copiar logs
    echo "📦 Backup dos logs..."
    rsync -avz $APP_USER@$HOSTINGER_IP:/var/log/leaf-app/ /tmp/hostinger-logs/
    
    # Copiar configurações
    echo "📦 Backup das configurações..."
    rsync -avz $APP_USER@$HOSTINGER_IP:/home/leaf/leaf-websocket-backend/config.env /tmp/hostinger-config.env
    
    echo "✅ Backup dos dados concluído"
}

# Função de migração do Redis
migrate_redis_data() {
    echo "🔄 Migrando dados do Redis..."
    
    # Parar Redis temporariamente
    systemctl stop redis-server
    
    # Fazer backup do Redis atual
    cp /var/lib/redis/dump.rdb /var/lib/redis/dump.rdb.backup
    
    # Copiar dados da Hostinger
    cp /tmp/hostinger-redis.rdb /var/lib/redis/dump.rdb
    chown redis:redis /var/lib/redis/dump.rdb
    
    # Reiniciar Redis
    systemctl start redis-server
    
    # Verificar se dados foram migrados
    redis_count=$(redis-cli dbsize)
    echo "✅ Redis migrado com $redis_count chaves"
}

# Função de migração de logs
migrate_logs() {
    echo "🔄 Migrando logs..."
    
    # Criar diretório de logs se não existir
    mkdir -p /var/log/leaf-app
    
    # Copiar logs da Hostinger
    if [ -d "/tmp/hostinger-logs" ]; then
        cp -r /tmp/hostinger-logs/* /var/log/leaf-app/
        chown -R $APP_USER:$APP_USER /var/log/leaf-app/
        echo "✅ Logs migrados com sucesso"
    else
        echo "⚠️ Nenhum log encontrado para migrar"
    fi
}

# Função de migração de configurações
migrate_config() {
    echo "🔄 Migrando configurações..."
    
    if [ -f "/tmp/hostinger-config.env" ]; then
        # Fazer backup da configuração atual
        cp $APP_DIR/leaf-websocket-backend/config.env $APP_DIR/leaf-websocket-backend/config.env.backup
        
        # Copiar configuração da Hostinger
        cp /tmp/hostinger-config.env $APP_DIR/leaf-websocket-backend/config.env
        
        # Atualizar configurações para Vultr
        sed -i 's/FALLBACK_MODE=true/PRIMARY_MODE=true/g' $APP_DIR/leaf-websocket-backend/config.env
        sed -i 's/MAX_CONNECTIONS=1000/MAX_CONNECTIONS=10000/g' $APP_DIR/leaf-websocket-backend/config.env
        sed -i 's/RATE_LIMIT_MAX=100/RATE_LIMIT_MAX=1000/g' $APP_DIR/leaf-websocket-backend/config.env
        sed -i 's/REDIS_MAX_MEMORY=800mb/REDIS_MAX_MEMORY=6gb/g' $APP_DIR/leaf-websocket-backend/config.env
        
        echo "✅ Configurações migradas e otimizadas"
    else
        echo "⚠️ Nenhuma configuração encontrada para migrar"
    fi
}

# Função de sincronização de código
sync_code() {
    echo "🔄 Sincronizando código..."
    
    # Fazer pull do repositório
    cd $APP_DIR/leaf-websocket-backend
    git pull origin main
    
    # Instalar dependências
    npm install
    
    echo "✅ Código sincronizado"
}

# Função de verificação de serviços
verify_services() {
    echo "🔍 Verificando serviços..."
    
    # Verificar Redis
    if systemctl is-active --quiet redis-server; then
        echo "✅ Redis está rodando"
    else
        echo "❌ Redis não está rodando"
        systemctl restart redis-server
    fi
    
    # Verificar aplicação
    if systemctl is-active --quiet leaf-primary; then
        echo "✅ Aplicação está rodando"
    else
        echo "❌ Aplicação não está rodando"
        systemctl restart leaf-primary
    fi
    
    # Verificar Nginx
    if systemctl is-active --quiet nginx; then
        echo "✅ Nginx está rodando"
    else
        echo "❌ Nginx não está rodando"
        systemctl restart nginx
    fi
}

# Função de teste de conectividade
test_connectivity() {
    echo "🧪 Testando conectividade..."
    
    # Testar health check
    if curl -s http://localhost/health > /dev/null; then
        echo "✅ Health check funcionando"
    else
        echo "❌ Health check falhou"
    fi
    
    # Testar API
    if curl -s http://localhost/api/health > /dev/null; then
        echo "✅ API funcionando"
    else
        echo "❌ API falhou"
    fi
    
    # Testar WebSocket
    if curl -s http://localhost/socket.io/ > /dev/null; then
        echo "✅ WebSocket funcionando"
    else
        echo "❌ WebSocket falhou"
    fi
}

# Função de atualização de DNS
update_dns() {
    echo "🌐 Atualizando DNS..."
    
    echo "⚠️ IMPORTANTE: Atualize os registros DNS manualmente:"
    echo "   - A record: leafapp.com -> $VULTR_IP"
    echo "   - CNAME: www.leafapp.com -> leafapp.com"
    echo ""
    echo "📋 Comandos para verificar:"
    echo "   dig leafapp.com"
    echo "   nslookup leafapp.com"
    echo "   curl -I https://leafapp.com/health"
}

# Função principal
main() {
    echo "🚀 INICIANDO MIGRAÇÃO COMPLETA PARA VULTR..."
    
    # 1. Backup dos dados
    backup_hostinger_data
    
    # 2. Migrar Redis
    migrate_redis_data
    
    # 3. Migrar logs
    migrate_logs
    
    # 4. Migrar configurações
    migrate_config
    
    # 5. Sincronizar código
    sync_code
    
    # 6. Verificar serviços
    verify_services
    
    # 7. Testar conectividade
    test_connectivity
    
    # 8. Atualizar DNS
    update_dns
    
    echo ""
    echo "✅ MIGRAÇÃO CONCLUÍDA COM SUCESSO!"
    echo ""
    echo "📊 Próximos passos:"
    echo "   1. Atualizar registros DNS"
    echo "   2. Configurar Hostinger como fallback"
    echo "   3. Testar failover"
    echo "   4. Monitorar performance"
    echo ""
    echo "🔧 Comandos úteis:"
    echo "   - systemctl status leaf-primary"
    echo "   - journalctl -u leaf-primary -f"
    echo "   - redis-cli info"
    echo "   - nginx -t"
    echo "   - ufw status"
}

# Executar função principal
main "$@" 