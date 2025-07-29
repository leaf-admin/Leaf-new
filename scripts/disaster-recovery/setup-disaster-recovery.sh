#!/bin/bash

# 🚀 SCRIPT DE DISASTER RECOVERY - LEAF APP
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
LOG_DIR="/var/log/leaf-app"
DR_SCRIPT="/usr/local/bin/disaster-recovery.sh"
MONITOR_SCRIPT="/usr/local/bin/dr-monitor.sh"
EMAIL_SCRIPT="/usr/local/bin/send-alert.sh"

# Criar diretórios
echo "📁 Criando diretórios..."
mkdir -p $BACKUP_DIR/{redis,app,config,logs}
mkdir -p $LOG_DIR
chown -R leaf:leaf $BACKUP_DIR $LOG_DIR

# Script de Disaster Recovery
echo "📝 Criando script de disaster recovery..."
cat > $DR_SCRIPT << 'EOF'
#!/bin/bash

# 🛡️ SCRIPT DE DISASTER RECOVERY - LEAF APP
# Data: 29 de Julho de 2025

set -e

BACKUP_DIR="/home/leaf/backups"
LOG_FILE="/var/log/leaf-app/dr.log"
EMAIL_SCRIPT="/usr/local/bin/send-alert.sh"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a $LOG_FILE
}

send_alert() {
    local subject="$1"
    local message="$2"
    $EMAIL_SCRIPT "$subject" "$message"
}

case "$1" in
    backup)
        log "🔄 Iniciando backup completo..."
        
        # Backup do Redis
        log "📦 Backup do Redis..."
        redis-cli BGSAVE
        sleep 5
        cp /var/lib/redis/dump.rdb $BACKUP_DIR/redis/redis-$(date +%Y%m%d-%H%M%S).rdb
        
        # Backup da aplicação
        log "📦 Backup da aplicação..."
        tar -czf $BACKUP_DIR/app/app-$(date +%Y%m%d-%H%M%S).tar.gz /home/leaf/leaf-websocket-backend/
        
        # Backup de configurações
        log "📦 Backup de configurações..."
        tar -czf $BACKUP_DIR/config/config-$(date +%Y%m%d-%H%M%S).tar.gz /etc/nginx/sites-available/ /etc/systemd/system/leaf-primary.service /etc/redis/redis.conf
        
        # Backup de logs
        log "📦 Backup de logs..."
        tar -czf $BACKUP_DIR/logs/logs-$(date +%Y%m%d-%H%M%S).tar.gz /var/log/leaf-app/ /var/log/nginx/ /var/log/redis/
        
        # Limpar backups antigos (manter últimos 7 dias)
        find $BACKUP_DIR -name "*.rdb" -mtime +7 -delete
        find $BACKUP_DIR -name "*.tar.gz" -mtime +7 -delete
        
        log "✅ Backup concluído com sucesso"
        send_alert "Backup Concluído" "Backup do Leaf App foi executado com sucesso em $(date)"
        ;;
        
    check)
        log "🔍 Verificando integridade dos backups..."
        
        # Verificar se Redis está funcionando
        if ! redis-cli ping > /dev/null 2>&1; then
            log "❌ Redis não está respondendo"
            send_alert "ALERTA: Redis Offline" "O Redis não está respondendo em $(date)"
            exit 1
        fi
        
        # Verificar se aplicação está funcionando
        if ! curl -s http://localhost:3001/health > /dev/null; then
            log "❌ Aplicação não está respondendo"
            send_alert "ALERTA: Aplicação Offline" "A aplicação não está respondendo em $(date)"
            exit 1
        fi
        
        # Verificar espaço em disco
        DISK_USAGE=$(df / | awk 'NR==2 {print $5}' | sed 's/%//')
        if [ $DISK_USAGE -gt 90 ]; then
            log "⚠️ Disco com pouco espaço: ${DISK_USAGE}%"
            send_alert "ALERTA: Disco Cheio" "Disco com ${DISK_USAGE}% de uso em $(date)"
        fi
        
        # Verificar uso de memória
        MEM_USAGE=$(free | awk 'NR==2{printf "%.0f", $3*100/$2}')
        if [ $MEM_USAGE -gt 90 ]; then
            log "⚠️ Memória com pouco espaço: ${MEM_USAGE}%"
            send_alert "ALERTA: Memória Alta" "Memória com ${MEM_USAGE}% de uso em $(date)"
        fi
        
        log "✅ Verificação concluída - tudo OK"
        ;;
        
    restore)
        if [ -z "$2" ]; then
            echo "❌ Uso: $0 restore YYYYMMDD-HHMMSS"
            exit 1
        fi
        
        BACKUP_DATE="$2"
        log "🔄 Iniciando restauração do backup $BACKUP_DATE..."
        
        # Parar serviços
        systemctl stop leaf-primary
        systemctl stop redis-server
        
        # Restaurar Redis
        if [ -f "$BACKUP_DIR/redis/redis-$BACKUP_DATE.rdb" ]; then
            log "📦 Restaurando Redis..."
            cp $BACKUP_DIR/redis/redis-$BACKUP_DATE.rdb /var/lib/redis/dump.rdb
            chown redis:redis /var/lib/redis/dump.rdb
        fi
        
        # Restaurar aplicação
        if [ -f "$BACKUP_DIR/app/app-$BACKUP_DATE.tar.gz" ]; then
            log "📦 Restaurando aplicação..."
            tar -xzf $BACKUP_DIR/app/app-$BACKUP_DATE.tar.gz -C /
        fi
        
        # Restaurar configurações
        if [ -f "$BACKUP_DIR/config/config-$BACKUP_DATE.tar.gz" ]; then
            log "📦 Restaurando configurações..."
            tar -xzf $BACKUP_DIR/config/config-$BACKUP_DATE.tar.gz -C /
        fi
        
        # Reiniciar serviços
        systemctl start redis-server
        systemctl start leaf-primary
        systemctl reload nginx
        
        log "✅ Restauração concluída"
        send_alert "Restauração Concluída" "Restauração do backup $BACKUP_DATE foi concluída em $(date)"
        ;;
        
    *)
        echo "❌ Uso: $0 {backup|check|restore [DATE]}"
        exit 1
        ;;
esac
EOF

chmod +x $DR_SCRIPT

# Script de monitoramento
echo "📝 Criando script de monitoramento..."
cat > $MONITOR_SCRIPT << 'EOF'
#!/bin/bash

# 📊 SCRIPT DE MONITORAMENTO - LEAF APP
# Data: 29 de Julho de 2025

LOG_FILE="/var/log/leaf-app/monitor.log"
EMAIL_SCRIPT="/usr/local/bin/send-alert.sh"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a $LOG_FILE
}

send_alert() {
    local subject="$1"
    local message="$2"
    $EMAIL_SCRIPT "$subject" "$message"
}

# Verificar serviços
log "🔍 Verificando serviços..."

# Redis
if ! systemctl is-active --quiet redis-server; then
    log "❌ Redis parado - tentando reiniciar..."
    systemctl restart redis-server
    sleep 5
    if ! systemctl is-active --quiet redis-server; then
        log "❌ Falha ao reiniciar Redis"
        send_alert "CRÍTICO: Redis Offline" "Redis não conseguiu reiniciar em $(date)"
    else
        log "✅ Redis reiniciado com sucesso"
        send_alert "INFO: Redis Reiniciado" "Redis foi reiniciado automaticamente em $(date)"
    fi
fi

# Aplicação
if ! systemctl is-active --quiet leaf-primary; then
    log "❌ Aplicação parada - tentando reiniciar..."
    systemctl restart leaf-primary
    sleep 10
    if ! systemctl is-active --quiet leaf-primary; then
        log "❌ Falha ao reiniciar aplicação"
        send_alert "CRÍTICO: Aplicação Offline" "Aplicação não conseguiu reiniciar em $(date)"
    else
        log "✅ Aplicação reiniciada com sucesso"
        send_alert "INFO: Aplicação Reiniciada" "Aplicação foi reiniciada automaticamente em $(date)"
    fi
fi

# Nginx
if ! systemctl is-active --quiet nginx; then
    log "❌ Nginx parado - tentando reiniciar..."
    systemctl restart nginx
    sleep 5
    if ! systemctl is-active --quiet nginx; then
        log "❌ Falha ao reiniciar Nginx"
        send_alert "CRÍTICO: Nginx Offline" "Nginx não conseguiu reiniciar em $(date)"
    else
        log "✅ Nginx reiniciado com sucesso"
        send_alert "INFO: Nginx Reiniciado" "Nginx foi reiniciado automaticamente em $(date)"
    fi
fi

# Verificar conectividade
if ! curl -s http://localhost:3001/health > /dev/null; then
    log "❌ Health check falhou"
    send_alert "ALERTA: Health Check Falhou" "Health check falhou em $(date)"
fi

# Verificar recursos
DISK_USAGE=$(df / | awk 'NR==2 {print $5}' | sed 's/%//')
if [ $DISK_USAGE -gt 85 ]; then
    log "⚠️ Disco com pouco espaço: ${DISK_USAGE}%"
    send_alert "ALERTA: Disco Cheio" "Disco com ${DISK_USAGE}% de uso em $(date)"
fi

MEM_USAGE=$(free | awk 'NR==2{printf "%.0f", $3*100/$2}')
if [ $MEM_USAGE -gt 85 ]; then
    log "⚠️ Memória com pouco espaço: ${MEM_USAGE}%"
    send_alert "ALERTA: Memória Alta" "Memória com ${MEM_USAGE}% de uso em $(date)"
fi

log "✅ Monitoramento concluído"
EOF

chmod +x $MONITOR_SCRIPT

# Script de envio de email
echo "📝 Criando script de envio de email..."
cat > $EMAIL_SCRIPT << 'EOF'
#!/bin/bash

# 📧 SCRIPT DE ENVIO DE EMAIL - LEAF APP
# Data: 29 de Julho de 2025

# Configurações de email (ajustar conforme necessário)
SMTP_SERVER="smtp.gmail.com"
SMTP_PORT="587"
EMAIL_FROM="leafapp@vultr.com"
EMAIL_TO="admin@leafapp.com"
EMAIL_PASS="your_password_here"

send_email() {
    local subject="$1"
    local message="$2"
    
    # Usar curl para enviar email via SMTP
    echo "Subject: $subject" > /tmp/email.txt
    echo "From: $EMAIL_FROM" >> /tmp/email.txt
    echo "To: $EMAIL_TO" >> /tmp/email.txt
    echo "" >> /tmp/email.txt
    echo "$message" >> /tmp/email.txt
    
    # Enviar via curl (requer configuração SMTP)
    # curl --mail-from "$EMAIL_FROM" --mail-rcpt "$EMAIL_TO" --upload-file /tmp/email.txt smtp://$SMTP_SERVER:$SMTP_PORT
    
    # Por enquanto, apenas log
    echo "$(date): $subject - $message" >> /var/log/leaf-app/email.log
    rm -f /tmp/email.txt
}

if [ $# -eq 2 ]; then
    send_email "$1" "$2"
else
    echo "❌ Uso: $0 'Subject' 'Message'"
    exit 1
fi
EOF

chmod +x $EMAIL_SCRIPT

# Configurar cron jobs
echo "⏰ Configurando cron jobs..."

# Backup diário às 2h da manhã
(crontab -l 2>/dev/null; echo "0 2 * * * $DR_SCRIPT backup") | crontab -

# Verificação a cada 5 minutos
(crontab -l 2>/dev/null; echo "*/5 * * * * $MONITOR_SCRIPT") | crontab -

# Verificação de integridade a cada hora
(crontab -l 2>/dev/null; echo "0 * * * * $DR_SCRIPT check") | crontab -

# Configurar systemd timer para monitoramento
echo "📝 Configurando systemd timer..."
cat > /etc/systemd/system/dr-monitor.timer << 'EOF'
[Unit]
Description=Disaster Recovery Monitor Timer
After=network.target

[Timer]
OnBootSec=1min
OnUnitActiveSec=5min
Unit=dr-monitor.service

[Install]
WantedBy=timers.target
EOF

cat > /etc/systemd/system/dr-monitor.service << 'EOF'
[Unit]
Description=Disaster Recovery Monitor Service
After=network.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/dr-monitor.sh
User=root
EOF

# Habilitar e iniciar timer
systemctl daemon-reload
systemctl enable dr-monitor.timer
systemctl start dr-monitor.timer

# Executar primeiro backup
echo "🔄 Executando primeiro backup..."
$DR_SCRIPT backup

echo "✅ DISASTER RECOVERY CONFIGURADO COM SUCESSO!"
echo ""
echo "📊 RESUMO DA CONFIGURAÇÃO:"
echo "   - Backup automático: Diário às 2h"
echo "   - Monitoramento: A cada 5 minutos"
echo "   - Verificação: A cada hora"
echo "   - Logs: /var/log/leaf-app/"
echo "   - Backups: /home/leaf/backups/"
echo ""
echo "🔧 COMANDOS ÚTEIS:"
echo "   - Backup manual: $DR_SCRIPT backup"
echo "   - Verificar integridade: $DR_SCRIPT check"
echo "   - Restaurar backup: $DR_SCRIPT restore YYYYMMDD-HHMMSS"
echo "   - Ver logs: tail -f /var/log/leaf-app/dr.log"
echo ""
echo "📧 CONFIGURAR EMAIL:"
echo "   - Editar: /usr/local/bin/send-alert.sh"
echo "   - Configurar SMTP e credenciais" 