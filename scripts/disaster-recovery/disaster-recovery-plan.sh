#!/bin/bash

# 🚀 SCRIPT DE DISASTER RECOVERY
# Data: 29 de Julho de 2025
# Autor: Leaf App Team

set -e

echo "🛡️ CONFIGURANDO DISASTER RECOVERY..."

# Verificar se está rodando como root
if [ "$EUID" -ne 0 ]; then
    echo "❌ Este script deve ser executado como root (sudo)"
    exit 1
fi

# Configurações
BACKUP_DIR="/home/leaf/backups"
DR_SCRIPT="/usr/local/bin/disaster-recovery.sh"
PRIMARY_IP="147.93.66.253"
BACKUP_IP="BACKUP_VPS_IP"

# Criar diretórios de backup
echo "📁 Criando diretórios de backup..."
mkdir -p $BACKUP_DIR/{redis,app,config,logs}
chown -R leaf:leaf $BACKUP_DIR

# Criar script de disaster recovery
echo "🔧 Criando script de disaster recovery..."
cat > $DR_SCRIPT << 'EOF'
#!/bin/bash

# Disaster Recovery Script
# Data: 29 de Julho de 2025

set -e

BACKUP_DIR="/home/leaf/backups"
PRIMARY_IP="147.93.66.253"
BACKUP_IP="BACKUP_VPS_IP"

# Função de logging
log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Função de backup completo
full_backup() {
    log_message "🔄 Iniciando backup completo..."
    
    # Backup do Redis
    log_message "📦 Backup do Redis..."
    redis-cli BGSAVE
    sleep 5
    cp /var/lib/redis/dump.rdb $BACKUP_DIR/redis/redis-$(date +%Y%m%d-%H%M%S).rdb
    
    # Backup da aplicação
    log_message "📦 Backup da aplicação..."
    tar -czf $BACKUP_DIR/app/app-$(date +%Y%m%d-%H%M%S).tar.gz /home/leaf/leaf-websocket-backend/
    
    # Backup das configurações
    log_message "📦 Backup das configurações..."
    tar -czf $BACKUP_DIR/config/config-$(date +%Y%m%d-%H%M%S).tar.gz /etc/nginx/ /etc/systemd/system/leaf-backup.service
    
    # Backup dos logs
    log_message "📦 Backup dos logs..."
    tar -czf $BACKUP_DIR/logs/logs-$(date +%Y%m%d-%H%M%S).tar.gz /var/log/leaf-app/ /home/leaf/leaf-websocket-backend/logs/
    
    # Limpar backups antigos (manter últimos 7 dias)
    find $BACKUP_DIR -name "*.rdb" -mtime +7 -delete
    find $BACKUP_DIR -name "*.tar.gz" -mtime +7 -delete
    
    log_message "✅ Backup completo finalizado"
}

# Função de verificação de integridade
check_integrity() {
    log_message "🔍 Verificando integridade dos backups..."
    
    # Verificar se arquivos de backup existem
    if [ ! -f "$BACKUP_DIR/redis/redis-$(date +%Y%m%d)*.rdb" ]; then
        log_message "❌ Backup do Redis não encontrado"
        return 1
    fi
    
    if [ ! -f "$BACKUP_DIR/app/app-$(date +%Y%m%d)*.tar.gz" ]; then
        log_message "❌ Backup da aplicação não encontrado"
        return 1
    fi
    
    # Verificar integridade dos arquivos
    for file in $BACKUP_DIR/*/*.tar.gz; do
        if [ -f "$file" ]; then
            if ! tar -tzf "$file" > /dev/null 2>&1; then
                log_message "❌ Arquivo corrompido: $file"
                return 1
            fi
        fi
    done
    
    log_message "✅ Integridade dos backups verificada"
    return 0
}

# Função de restauração
restore_from_backup() {
    local backup_date=$1
    
    if [ -z "$backup_date" ]; then
        log_message "❌ Data do backup não especificada"
        echo "Uso: $0 restore YYYYMMDD-HHMMSS"
        exit 1
    fi
    
    log_message "🔄 Iniciando restauração do backup $backup_date..."
    
    # Parar serviços
    systemctl stop leaf-backup
    systemctl stop redis-server
    
    # Restaurar Redis
    log_message "📦 Restaurando Redis..."
    redis_backup="$BACKUP_DIR/redis/redis-$backup_date.rdb"
    if [ -f "$redis_backup" ]; then
        cp "$redis_backup" /var/lib/redis/dump.rdb
        chown redis:redis /var/lib/redis/dump.rdb
    else
        log_message "❌ Backup do Redis não encontrado: $redis_backup"
        return 1
    fi
    
    # Restaurar aplicação
    log_message "📦 Restaurando aplicação..."
    app_backup="$BACKUP_DIR/app/app-$backup_date.tar.gz"
    if [ -f "$app_backup" ]; then
        tar -xzf "$app_backup" -C /
    else
        log_message "❌ Backup da aplicação não encontrado: $app_backup"
        return 1
    fi
    
    # Restaurar configurações
    log_message "📦 Restaurando configurações..."
    config_backup="$BACKUP_DIR/config/config-$backup_date.tar.gz"
    if [ -f "$config_backup" ]; then
        tar -xzf "$config_backup" -C /
    fi
    
    # Reiniciar serviços
    systemctl start redis-server
    systemctl start leaf-backup
    
    log_message "✅ Restauração finalizada"
}

# Função de failover
failover() {
    log_message "🚨 Iniciando failover..."
    
    # Verificar se VPS principal está down
    if ping -c 3 $PRIMARY_IP > /dev/null 2>&1; then
        log_message "⚠️ VPS principal ainda está respondendo"
        return 1
    fi
    
    log_message "🔴 VPS principal está down, ativando backup..."
    
    # Ativar modo backup
    echo "BACKUP_MODE=true" >> /home/leaf/leaf-websocket-backend/config.env
    
    # Reiniciar aplicação
    systemctl restart leaf-backup
    
    # Notificar administrador
    echo "🚨 FAILOVER ATIVADO - VPS Principal Down" | mail -s "Leaf App - Failover Ativado" admin@leafapp.com
    
    log_message "✅ Failover ativado com sucesso"
}

# Função de monitoramento
monitor_primary() {
    log_message "👁️ Monitorando VPS principal..."
    
    if ! ping -c 1 $PRIMARY_IP > /dev/null 2>&1; then
        log_message "🚨 VPS principal não responde!"
        failover
    else
        log_message "✅ VPS principal funcionando normalmente"
    fi
}

# Função principal
main() {
    case "$1" in
        "backup")
            full_backup
            check_integrity
            ;;
        "restore")
            restore_from_backup "$2"
            ;;
        "check")
            check_integrity
            ;;
        "failover")
            failover
            ;;
        "monitor")
            monitor_primary
            ;;
        *)
            echo "Uso: $0 {backup|restore|check|failover|monitor}"
            echo "  backup   - Fazer backup completo"
            echo "  restore  - Restaurar de backup (especificar data)"
            echo "  check    - Verificar integridade dos backups"
            echo "  failover - Ativar failover manualmente"
            echo "  monitor  - Monitorar VPS principal"
            exit 1
            ;;
    esac
}

# Executar função principal
main "$@"
EOF

chmod +x $DR_SCRIPT

# Criar serviço de monitoramento
echo "🔧 Criando serviço de monitoramento..."
cat > /etc/systemd/system/dr-monitor.service << 'EOF'
[Unit]
Description=Disaster Recovery Monitor
After=network.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/disaster-recovery.sh monitor
User=root

[Install]
WantedBy=multi-user.target
EOF

# Criar timer para monitoramento
cat > /etc/systemd/system/dr-monitor.timer << 'EOF'
[Unit]
Description=Run DR Monitor every 5 minutes
Requires=dr-monitor.service

[Timer]
OnCalendar=*:0/5
Persistent=true

[Install]
WantedBy=timers.target
EOF

# Habilitar serviços
systemctl daemon-reload
systemctl enable dr-monitor.timer
systemctl start dr-monitor.timer

# Configurar backup automático
echo "🔄 Configurando backup automático..."
echo "0 2 * * * /usr/local/bin/disaster-recovery.sh backup" | crontab -

# Testar backup
echo "🧪 Testando backup..."
$DR_SCRIPT backup

echo "✅ DISASTER RECOVERY CONFIGURADO COM SUCESSO!"
echo "📊 Monitoramento: systemctl status dr-monitor.timer"
echo "🔄 Backup automático: 02:00 diariamente"
echo "🔧 Comandos disponíveis:"
echo "  - $DR_SCRIPT backup"
echo "  - $DR_SCRIPT restore YYYYMMDD-HHMMSS"
echo "  - $DR_SCRIPT check"
echo "  - $DR_SCRIPT failover" 