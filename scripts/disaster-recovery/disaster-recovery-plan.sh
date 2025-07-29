#!/bin/bash

# Disaster Recovery Plan
# Data: 29/07/2025
# Status: ✅ DISASTER RECOVERY

# Configurações
BACKUP_DIR="/home/leaf/backups"
RESTORE_DIR="/home/leaf/restore"
LOG_FILE="/var/log/disaster-recovery.log"
CONTACT_EMAIL="admin@leafapp.com"

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Função de logging
log_message() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')] $1${NC}" | tee -a $LOG_FILE
}

log_error() {
    echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}" | tee -a $LOG_FILE
}

log_warning() {
    echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] WARNING: $1${NC}" | tee -a $LOG_FILE
}

# Função de notificação
send_notification() {
    local subject="$1"
    local message="$2"
    
    # Email notification
    if command -v mail &> /dev/null; then
        echo "$message" | mail -s "$subject" $CONTACT_EMAIL
    fi
    
    # Log notification
    log_message "NOTIFICATION: $subject - $message"
}

# Verificar se script está rodando como root
check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "Este script deve ser executado como root"
        exit 1
    fi
}

# Backup completo do sistema
create_full_backup() {
    log_message "=== INICIANDO BACKUP COMPLETO DO SISTEMA ==="
    
    local timestamp=$(date '+%Y%m%d_%H%M%S')
    local backup_name="full_backup_$timestamp"
    local backup_path="$BACKUP_DIR/$backup_name"
    
    mkdir -p $backup_path
    
    # Backup do Redis
    log_message "Backup do Redis..."
    redis-cli SAVE
    cp /var/lib/redis/dump.rdb "$backup_path/redis_dump.rdb"
    
    # Backup das configurações
    log_message "Backup das configurações..."
    cp -r /etc/nginx "$backup_path/nginx_config"
    cp -r /etc/letsencrypt "$backup_path/ssl_certs"
    cp -r /home/leaf/leaf-websocket-backend "$backup_path/app_code"
    
    # Backup dos logs
    log_message "Backup dos logs..."
    cp -r /var/log "$backup_path/logs"
    
    # Backup das configurações do sistema
    log_message "Backup das configurações do sistema..."
    cp /etc/hosts "$backup_path/hosts"
    cp /etc/resolv.conf "$backup_path/resolv.conf"
    ufw status > "$backup_path/ufw_status.txt"
    
    # Comprimir backup
    log_message "Comprimindo backup..."
    tar -czf "$backup_path.tar.gz" -C $BACKUP_DIR $backup_name
    rm -rf $backup_path
    
    log_message "Backup completo criado: $backup_path.tar.gz"
    send_notification "Backup Completo" "Backup criado: $backup_path.tar.gz"
}

# Restaurar sistema do backup
restore_from_backup() {
    local backup_file="$1"
    
    if [ ! -f "$backup_file" ]; then
        log_error "Arquivo de backup não encontrado: $backup_file"
        exit 1
    fi
    
    log_message "=== INICIANDO RESTAURAÇÃO DO SISTEMA ==="
    
    # Criar diretório de restauração
    mkdir -p $RESTORE_DIR
    cd $RESTORE_DIR
    
    # Extrair backup
    log_message "Extraindo backup..."
    tar -xzf "$backup_file"
    
    # Parar serviços
    log_message "Parando serviços..."
    systemctl stop nginx
    systemctl stop redis-server
    
    # Restaurar Redis
    log_message "Restaurando Redis..."
    cp redis_dump.rdb /var/lib/redis/dump.rdb
    chown redis:redis /var/lib/redis/dump.rdb
    
    # Restaurar configurações do Nginx
    log_message "Restaurando Nginx..."
    cp -r nginx_config/* /etc/nginx/
    
    # Restaurar certificados SSL
    log_message "Restaurando certificados SSL..."
    cp -r ssl_certs/* /etc/letsencrypt/
    
    # Restaurar código da aplicação
    log_message "Restaurando código da aplicação..."
    cp -r app_code/* /home/leaf/leaf-websocket-backend/
    
    # Restaurar logs
    log_message "Restaurando logs..."
    cp -r logs/* /var/log/
    
    # Restaurar configurações do sistema
    log_message "Restaurando configurações do sistema..."
    cp hosts /etc/hosts
    cp resolv.conf /etc/resolv.conf
    
    # Reiniciar serviços
    log_message "Reiniciando serviços..."
    systemctl start redis-server
    systemctl start nginx
    
    # Verificar serviços
    log_message "Verificando serviços..."
    if systemctl is-active --quiet redis-server && systemctl is-active --quiet nginx; then
        log_message "Restauração concluída com sucesso"
        send_notification "Restauração Concluída" "Sistema restaurado do backup: $backup_file"
    else
        log_error "Falha na restauração dos serviços"
        exit 1
    fi
}

# Verificar integridade do sistema
check_system_integrity() {
    log_message "=== VERIFICANDO INTEGRIDADE DO SISTEMA ==="
    
    local issues=0
    
    # Verificar serviços críticos
    log_message "Verificando serviços críticos..."
    
    if ! systemctl is-active --quiet redis-server; then
        log_error "Redis não está rodando"
        issues=$((issues + 1))
    fi
    
    if ! systemctl is-active --quiet nginx; then
        log_error "Nginx não está rodando"
        issues=$((issues + 1))
    fi
    
    # Verificar conectividade
    log_message "Verificando conectividade..."
    
    if ! ping -c 1 8.8.8.8 > /dev/null 2>&1; then
        log_error "Sem conectividade com internet"
        issues=$((issues + 1))
    fi
    
    # Verificar espaço em disco
    log_message "Verificando espaço em disco..."
    
    local disk_usage=$(df / | awk 'NR==2 {print $5}' | cut -d'%' -f1)
    if [ $disk_usage -gt 90 ]; then
        log_warning "Uso de disco alto: ${disk_usage}%"
        issues=$((issues + 1))
    fi
    
    # Verificar memória
    log_message "Verificando memória..."
    
    local mem_usage=$(free | awk 'NR==2{printf "%.0f", $3*100/$2}')
    if [ $mem_usage -gt 90 ]; then
        log_warning "Uso de memória alto: ${mem_usage}%"
        issues=$((issues + 1))
    fi
    
    # Verificar certificados SSL
    log_message "Verificando certificados SSL..."
    
    if [ ! -f "/etc/letsencrypt/live/leafapp.com/fullchain.pem" ]; then
        log_error "Certificado SSL não encontrado"
        issues=$((issues + 1))
    fi
    
    if [ $issues -eq 0 ]; then
        log_message "✅ Sistema íntegro - nenhum problema encontrado"
        return 0
    else
        log_warning "⚠️ $issues problema(s) encontrado(s)"
        return 1
    fi
}

# Procedimento de emergência
emergency_procedure() {
    log_message "=== PROCEDIMENTO DE EMERGÊNCIA ==="
    
    # 1. Parar todos os serviços
    log_message "1. Parando todos os serviços..."
    systemctl stop nginx
    systemctl stop redis-server
    pkill -f "node.*server.js"
    
    # 2. Verificar hardware
    log_message "2. Verificando hardware..."
    dmesg | tail -20 > /tmp/hardware_check.log
    
    # 3. Verificar logs de erro
    log_message "3. Verificando logs de erro..."
    journalctl -p err --since "1 hour ago" > /tmp/error_logs.log
    
    # 4. Tentar reiniciar serviços
    log_message "4. Tentando reiniciar serviços..."
    systemctl start redis-server
    systemctl start nginx
    
    # 5. Verificar se funcionou
    if systemctl is-active --quiet redis-server && systemctl is-active --quiet nginx; then
        log_message "✅ Serviços reiniciados com sucesso"
        send_notification "Emergência Resolvida" "Serviços reiniciados automaticamente"
    else
        log_error "❌ Falha ao reiniciar serviços"
        send_notification "EMERGÊNCIA CRÍTICA" "Serviços não conseguem ser reiniciados"
    fi
}

# Plano de recuperação automática
auto_recovery() {
    log_message "=== RECUPERAÇÃO AUTOMÁTICA ==="
    
    # Verificar integridade
    if check_system_integrity; then
        log_message "Sistema está funcionando normalmente"
        return 0
    fi
    
    # Tentar recuperação automática
    log_message "Tentando recuperação automática..."
    
    # Reiniciar serviços
    systemctl restart redis-server
    systemctl restart nginx
    
    # Aguardar um pouco
    sleep 10
    
    # Verificar novamente
    if check_system_integrity; then
        log_message "✅ Recuperação automática bem-sucedida"
        send_notification "Recuperação Automática" "Sistema recuperado automaticamente"
        return 0
    else
        log_error "❌ Recuperação automática falhou"
        send_notification "RECUPERAÇÃO FALHOU" "Intervenção manual necessária"
        return 1
    fi
}

# Função principal
main() {
    local action="$1"
    local backup_file="$2"
    
    # Verificações
    check_root
    
    case $action in
        "backup")
            create_full_backup
            ;;
        "restore")
            if [ -z "$backup_file" ]; then
                log_error "Especifique o arquivo de backup para restauração"
                echo "Uso: $0 restore <arquivo_backup>"
                exit 1
            fi
            restore_from_backup "$backup_file"
            ;;
        "check")
            check_system_integrity
            ;;
        "emergency")
            emergency_procedure
            ;;
        "auto-recovery")
            auto_recovery
            ;;
        *)
            echo "Uso: $0 {backup|restore|check|emergency|auto-recovery}"
            echo ""
            echo "Comandos:"
            echo "  backup          - Criar backup completo do sistema"
            echo "  restore <file>  - Restaurar sistema do backup"
            echo "  check           - Verificar integridade do sistema"
            echo "  emergency       - Procedimento de emergência"
            echo "  auto-recovery   - Tentar recuperação automática"
            exit 1
            ;;
    esac
}

# Executar função principal
main "$@" 