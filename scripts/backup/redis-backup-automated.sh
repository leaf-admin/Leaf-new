#!/bin/bash

# Redis Backup Automation Script
# Data: 29/07/2025
# Status: ✅ AUTOMATED BACKUP

# Configurações
REDIS_HOST="localhost"
REDIS_PORT="6379"
REDIS_PASSWORD=""  # Se configurado
BACKUP_DIR="/home/leaf/backups/redis"
RETENTION_DAYS=7
LOG_FILE="/var/log/redis-backup.log"
NOTIFICATION_EMAIL="admin@leafapp.com"

# Criar diretório de backup se não existir
mkdir -p $BACKUP_DIR

# Função de logging
log_message() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a $LOG_FILE
}

# Função de notificação
send_notification() {
    local subject="$1"
    local message="$2"
    
    # Email notification (se configurado)
    if command -v mail &> /dev/null; then
        echo "$message" | mail -s "$subject" $NOTIFICATION_EMAIL
    fi
    
    # Log notification
    log_message "NOTIFICATION: $subject - $message"
}

# Verificar se Redis está rodando
check_redis_status() {
    if ! redis-cli ping &> /dev/null; then
        log_message "ERROR: Redis não está rodando!"
        send_notification "Redis Backup Error" "Redis não está rodando - backup falhou"
        exit 1
    fi
}

# Criar backup
create_backup() {
    local timestamp=$(date '+%Y%m%d_%H%M%S')
    local backup_file="$BACKUP_DIR/redis_backup_$timestamp.rdb"
    
    log_message "Iniciando backup do Redis..."
    
    # Forçar SAVE do Redis
    redis-cli SAVE
    
    # Copiar arquivo RDB
    if cp /var/lib/redis/dump.rdb "$backup_file"; then
        log_message "Backup criado: $backup_file"
        
        # Comprimir backup
        gzip "$backup_file"
        log_message "Backup comprimido: $backup_file.gz"
        
        # Verificar integridade
        if gzip -t "$backup_file.gz" 2>/dev/null; then
            log_message "Backup verificado com sucesso"
            send_notification "Redis Backup Success" "Backup criado: $backup_file.gz"
        else
            log_message "ERROR: Backup corrompido!"
            send_notification "Redis Backup Error" "Backup corrompido: $backup_file.gz"
            exit 1
        fi
    else
        log_message "ERROR: Falha ao criar backup"
        send_notification "Redis Backup Error" "Falha ao criar backup"
        exit 1
    fi
}

# Limpar backups antigos
cleanup_old_backups() {
    log_message "Limpando backups antigos (mais de $RETENTION_DAYS dias)..."
    
    local deleted_count=0
    while IFS= read -r -d '' file; do
        if [[ $(find "$file" -mtime +$RETENTION_DAYS) ]]; then
            rm "$file"
            deleted_count=$((deleted_count + 1))
            log_message "Backup antigo removido: $file"
        fi
    done < <(find $BACKUP_DIR -name "*.gz" -print0)
    
    log_message "Limpeza concluída: $deleted_count arquivos removidos"
}

# Verificar espaço em disco
check_disk_space() {
    local available_space=$(df $BACKUP_DIR | awk 'NR==2 {print $4}')
    local required_space=1000000  # 1GB em KB
    
    if [ $available_space -lt $required_space ]; then
        log_message "WARNING: Espaço em disco insuficiente!"
        send_notification "Redis Backup Warning" "Espaço em disco insuficiente para backup"
    fi
}

# Função principal
main() {
    log_message "=== INICIANDO BACKUP AUTOMÁTICO DO REDIS ==="
    
    # Verificações
    check_redis_status
    check_disk_space
    
    # Executar backup
    create_backup
    
    # Limpeza
    cleanup_old_backups
    
    log_message "=== BACKUP CONCLUÍDO COM SUCESSO ==="
}

# Executar função principal
main "$@" 