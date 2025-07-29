#!/bin/bash

# 🚀 SCRIPT DE CONFIGURAÇÃO VULTR ECONÔMICO
# Data: 29 de Julho de 2025
# Autor: Leaf App Team

set -e

echo "🏆 CONFIGURANDO VULTR COMO SERVIDOR PRINCIPAL (ECONÔMICO)..."

# Verificar se está rodando como root
if [ "$EUID" -ne 0 ]; then
    echo "❌ Este script deve ser executado como root (sudo)"
    exit 1
fi

# Configurações
APP_USER="leaf"
APP_DIR="/home/$APP_USER"
BACKUP_IP="147.93.66.253"  # Hostinger como fallback

echo "📦 Atualizando sistema..."
apt update && apt upgrade -y

echo "📦 Instalando dependências..."
apt install -y curl wget git nginx redis-server nodejs npm ufw fail2ban htop

# Criar usuário leaf
echo "👤 Criando usuário leaf..."
useradd -m -s /bin/bash $APP_USER || true
usermod -aG sudo $APP_USER

# Configurar diretórios
echo "📁 Configurando diretórios..."
mkdir -p $APP_DIR
chown $APP_USER:$APP_USER $APP_DIR

# Clonar repositório
echo "📥 Clonando repositório..."
cd $APP_DIR
if [ ! -d "leaf-websocket-backend" ]; then
    git clone https://github.com/leafapp/leaf-websocket-backend.git
fi

# Configurar Redis otimizado para 4GB RAM (econômico)
echo "🔴 Configurando Redis otimizado (econômico)..."
cat > /etc/redis/redis.conf << 'EOF'
# Redis Configuration for Leaf App (4GB RAM - Econômico)
bind 127.0.0.1
port 6379
timeout 300
tcp-keepalive 60
loglevel notice
logfile /var/log/redis/redis-server.log
databases 16
save 900 1
save 300 10
save 60 10000
stop-writes-on-bgsave-error yes
rdbcompression yes
rdbchecksum yes
dbfilename dump.rdb
dir /var/lib/redis
maxmemory 3gb
maxmemory-policy allkeys-lru
appendonly yes
appendfilename "appendonly.aof"
appendfsync everysec
no-appendfsync-on-rewrite no
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb
# Otimizações econômicas
tcp-backlog 511
tcp-keepalive 300
EOF

systemctl enable redis-server
systemctl restart redis-server

# Configurar Nginx otimizado (econômico)
echo "🌐 Configurando Nginx otimizado (econômico)..."
cat > /etc/nginx/nginx.conf << 'EOF'
user www-data;
worker_processes 2;
pid /run/nginx.pid;
include /etc/nginx/modules-enabled/*.conf;

events {
    worker_connections 2048;
    use epoll;
    multi_accept on;
}

http {
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;
    client_max_body_size 10M;
    
    # Gzip compression (otimizado)
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types
        text/plain
        text/css
        text/xml
        text/javascript
        application/json
        application/javascript
        application/xml+rss
        application/atom+xml
        image/svg+xml;
    
    # Rate limiting (econômico)
    limit_req_zone $binary_remote_addr zone=api:10m rate=50r/s;
    limit_req_zone $binary_remote_addr zone=websocket:10m rate=25r/s;
    
    include /etc/nginx/conf.d/*.conf;
    include /etc/nginx/sites-enabled/*;
}
EOF

# Configurar site principal (econômico)
cat > /etc/nginx/sites-available/leaf-primary << 'EOF'
server {
    listen 80;
    server_name leafapp.com www.leafapp.com;
    
    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name leafapp.com www.leafapp.com;
    
    # SSL Configuration
    ssl_certificate /etc/letsencrypt/live/leafapp.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/leafapp.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    
    # Security Headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    
    # API Endpoints (econômico)
    location /api/ {
        limit_req zone=api burst=25 nodelay;
        
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
    }
    
    # WebSocket Endpoints (econômico)
    location /socket.io/ {
        limit_req zone=websocket burst=15 nodelay;
        
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
        proxy_buffering off;
        proxy_cache off;
    }
    
    # Health Check Endpoint
    location /health {
        access_log off;
        return 200 "healthy\n";
        add_header Content-Type text/plain;
    }
    
    # Load Balancer Status
    location /lb-status {
        access_log off;
        stub_status on;
        allow 127.0.0.1;
        deny all;
    }
    
    # Security: Block access to sensitive files
    location ~ /\. {
        deny all;
    }
    
    location ~ \.(htaccess|htpasswd|ini|log|sh|sql|conf)$ {
        deny all;
    }
}
EOF

ln -sf /etc/nginx/sites-available/leaf-primary /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Configurar aplicação
echo "⚙️ Configurando aplicação..."
cd $APP_DIR/leaf-websocket-backend
npm install

# Criar arquivo de configuração otimizado (econômico)
cat > $APP_DIR/leaf-websocket-backend/config.env << 'EOF'
# Configurações do Servidor Principal (Vultr - Econômico)
PORT=3001
NODE_ENV=production

# Redis Configuration (4GB RAM - Econômico)
REDIS_URL=redis://localhost:6379
REDIS_MAX_MEMORY=3gb
REDIS_MAX_MEMORY_POLICY=allkeys-lru

# Firebase Configuration
FIREBASE_DATABASE_URL=https://leaf-reactnative-default-rtdb.firebaseio.com
FIREBASE_PROJECT_ID=leaf-reactnative

# Logs (otimizado)
LOG_LEVEL=info
LOG_ROTATION=7
LOG_MAX_SIZE=25mb

# Performance (econômico)
MAX_CONNECTIONS=5000
HEALTH_CHECK_INTERVAL=30000
RATE_LIMIT_WINDOW=60000
RATE_LIMIT_MAX=500

# Primary Configuration
PRIMARY_MODE=true
BACKUP_SERVER=147.93.66.253
FAILOVER_ENABLED=true

# Otimizações econômicas
COMPRESSION_ENABLED=true
CACHE_ENABLED=true
MONITORING_INTERVAL=60000
EOF

# Criar serviço systemd otimizado (econômico)
echo "🔧 Criando serviço systemd otimizado (econômico)..."
cat > /etc/systemd/system/leaf-primary.service << EOF
[Unit]
Description=Leaf App Primary Server (Vultr - Econômico)
After=network.target redis-server.service

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR/leaf-websocket-backend
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=PORT=3001

# Resource limits (econômico)
LimitNOFILE=32768
LimitNPROC=2048

# Memory limits (econômico)
MemoryMax=3G
MemoryHigh=2.5G

# CPU limits (econômico)
CPUQuota=200%

[Install]
WantedBy=multi-user.target
EOF

# Habilitar e iniciar serviço
systemctl daemon-reload
systemctl enable leaf-primary
systemctl start leaf-primary

# Configurar firewall básico
echo "🔥 Configurando firewall básico..."
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3000/tcp
ufw allow 3001/tcp
ufw --force enable

# Configurar fail2ban básico
echo "🛡️ Configurando fail2ban básico..."
cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 3

[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3

[nginx-http-auth]
enabled = true
filter = nginx-http-auth
port = http,https
logpath = /var/log/nginx/error.log
maxretry = 3
EOF

systemctl enable fail2ban
systemctl start fail2ban

# Configurar monitoramento básico (econômico)
echo "📊 Configurando monitoramento básico (econômico)..."
cat > /usr/local/bin/vultr-monitor-economico.sh << 'EOF'
#!/bin/bash

# Monitoramento básico para Vultr (econômico)
LOG_FILE="/var/log/leaf-app/monitor.log"
ALERT_EMAIL="admin@leafapp.com"

# Função de logging
log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> $LOG_FILE
}

# Verificar CPU (limite mais baixo para econômico)
cpu_usage=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1)
if (( $(echo "$cpu_usage > 85" | bc -l) )); then
    log_message "ALERTA: CPU usage alto: ${cpu_usage}%"
    echo "ALERTA: CPU usage alto: ${cpu_usage}%" | mail -s "Leaf App - CPU Alert" $ALERT_EMAIL
fi

# Verificar RAM (limite mais baixo para econômico)
ram_usage=$(free | awk 'NR==2{printf "%.0f", $3*100/$2}')
if [ $ram_usage -gt 85 ]; then
    log_message "ALERTA: RAM usage alto: ${ram_usage}%"
    echo "ALERTA: RAM usage alto: ${ram_usage}%" | mail -s "Leaf App - RAM Alert" $ALERT_EMAIL
fi

# Verificar serviços
if ! systemctl is-active --quiet leaf-primary; then
    log_message "ERRO: Leaf primary service down"
    echo "ERRO: Leaf primary service down" | mail -s "Leaf App - Service Down" $ALERT_EMAIL
    systemctl restart leaf-primary
fi

if ! systemctl is-active --quiet redis-server; then
    log_message "ERRO: Redis service down"
    echo "ERRO: Redis service down" | mail -s "Leaf App - Redis Down" $ALERT_EMAIL
    systemctl restart redis-server
fi

if ! systemctl is-active --quiet nginx; then
    log_message "ERRO: Nginx service down"
    echo "ERRO: Nginx service down" | mail -s "Leaf App - Nginx Down" $ALERT_EMAIL
    systemctl restart nginx
fi

# Verificar conectividade com backup
if ! ping -c 1 $BACKUP_IP > /dev/null 2>&1; then
    log_message "ALERTA: Backup server não responde"
fi

log_message "Monitoramento executado com sucesso"
EOF

chmod +x /usr/local/bin/vultr-monitor-economico.sh

# Adicionar ao cron (menos frequente para economizar)
echo "*/5 * * * * /usr/local/bin/vultr-monitor-economico.sh" | crontab -

# Criar diretório de logs
mkdir -p /var/log/leaf-app
chown $APP_USER:$APP_USER /var/log/leaf-app

# Configurar backup automático (econômico)
echo "🔄 Configurando backup automático (econômico)..."
cat > /usr/local/bin/backup-economico.sh << 'EOF'
#!/bin/bash

# Backup automático econômico
BACKUP_DIR="/home/leaf/backups"
DATE=$(date +%Y%m%d-%H%M%S)

# Criar backup do Redis (comprimido)
redis-cli BGSAVE
sleep 5
cp /var/lib/redis/dump.rdb $BACKUP_DIR/redis-$DATE.rdb
gzip $BACKUP_DIR/redis-$DATE.rdb

# Criar backup da aplicação (comprimido)
tar -czf $BACKUP_DIR/app-$DATE.tar.gz /home/leaf/leaf-websocket-backend/

# Limpar backups antigos (manter últimos 5 dias)
find $BACKUP_DIR -name "*.rdb.gz" -mtime +5 -delete
find $BACKUP_DIR -name "*.tar.gz" -mtime +5 -delete

echo "Backup econômico criado: $DATE"
EOF

chmod +x /usr/local/bin/backup-economico.sh

# Adicionar backup ao cron (menos frequente)
echo "0 2 * * * /usr/local/bin/backup-economico.sh" | crontab -

echo "✅ VULTR ECONÔMICO CONFIGURADO COM SUCESSO!"
echo "📊 Status: http://$(hostname -I | awk '{print $1}')/health"
echo "🔧 Serviço: systemctl status leaf-primary"
echo "📝 Logs: journalctl -u leaf-primary -f"
echo "🛡️ Firewall: ufw status"
echo "📊 Monitoramento: tail -f /var/log/leaf-app/monitor.log"
echo "💰 Configuração econômica ativa - 4+ meses de crédito!" 