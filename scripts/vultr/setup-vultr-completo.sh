#!/bin/bash

# 🚀 SCRIPT DE CONFIGURAÇÃO VULTR COMPLETO
# Data: 29 de Julho de 2025
# Autor: Leaf App Team

set -e

echo "🏆 CONFIGURANDO VULTR COMO SERVIDOR PRINCIPAL (COMPLETO)..."

# Verificar se está rodando como root
if [ "$EUID" -ne 0 ]; then
    echo "❌ Este script deve ser executado como root (sudo)"
    exit 1
fi

# Configurações
APP_USER="leaf"
APP_DIR="/home/$APP_USER"
VULTR_IP="216.238.107.59"
BACKUP_IP="147.93.66.253"  # Hostinger como fallback

echo "📦 Atualizando sistema..."
apt update && apt upgrade -y

echo "📦 Instalando dependências..."
apt install -y curl wget git nginx redis-server nodejs npm ufw fail2ban htop bc

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

# Configurar Redis otimizado para 8GB RAM (completo)
echo "🔴 Configurando Redis otimizado (completo)..."
cat > /etc/redis/redis.conf << 'EOF'
# Redis Configuration for Leaf App (8GB RAM - Completo)
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
maxmemory 6gb
maxmemory-policy allkeys-lru
appendonly yes
appendfilename "appendonly.aof"
appendfsync everysec
no-appendfsync-on-rewrite no
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb
# Otimizações para 8GB RAM
tcp-backlog 511
tcp-keepalive 300
# Configurações de performance
hash-max-ziplist-entries 512
hash-max-ziplist-value 64
list-max-ziplist-size -2
list-compress-depth 0
set-max-intset-entries 512
zset-max-ziplist-entries 128
zset-max-ziplist-value 64
EOF

systemctl enable redis-server
systemctl restart redis-server

# Configurar Nginx otimizado (completo)
echo "🌐 Configurando Nginx otimizado (completo)..."
cat > /etc/nginx/nginx.conf << 'EOF'
user www-data;
worker_processes 4;
pid /run/nginx.pid;
include /etc/nginx/modules-enabled/*.conf;

events {
    worker_connections 4096;
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
    
    # Rate limiting (completo)
    limit_req_zone $binary_remote_addr zone=api:10m rate=100r/s;
    limit_req_zone $binary_remote_addr zone=websocket:10m rate=50r/s;
    
    include /etc/nginx/conf.d/*.conf;
    include /etc/nginx/sites-enabled/*;
}
EOF

# Configurar site principal (completo)
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
    
    # API Endpoints (completo)
    location /api/ {
        limit_req zone=api burst=50 nodelay;
        
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
    
    # WebSocket Endpoints (completo)
    location /socket.io/ {
        limit_req zone=websocket burst=25 nodelay;
        
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

# Criar arquivo de configuração otimizado (completo)
cat > $APP_DIR/leaf-websocket-backend/config.env << 'EOF'
# Configurações do Servidor Principal (Vultr - Completo)
PORT=3001
NODE_ENV=production

# Redis Configuration (8GB RAM - Completo)
REDIS_URL=redis://localhost:6379
REDIS_MAX_MEMORY=6gb
REDIS_MAX_MEMORY_POLICY=allkeys-lru

# Firebase Configuration
FIREBASE_DATABASE_URL=https://leaf-reactnative-default-rtdb.firebaseio.com
FIREBASE_PROJECT_ID=leaf-reactnative

# Logs
LOG_LEVEL=info
LOG_ROTATION=10
LOG_MAX_SIZE=50mb

# Performance (completo)
MAX_CONNECTIONS=10000
HEALTH_CHECK_INTERVAL=30000
RATE_LIMIT_WINDOW=60000
RATE_LIMIT_MAX=1000

# Primary Configuration
PRIMARY_MODE=true
BACKUP_SERVER=147.93.66.253
FAILOVER_ENABLED=true

# Otimizações completas
COMPRESSION_ENABLED=true
CACHE_ENABLED=true
MONITORING_INTERVAL=30000
EOF

# Criar serviço systemd otimizado (completo)
echo "🔧 Criando serviço systemd otimizado (completo)..."
cat > /etc/systemd/system/leaf-primary.service << EOF
[Unit]
Description=Leaf App Primary Server (Vultr - Completo)
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

# Resource limits (completo)
LimitNOFILE=65536
LimitNPROC=4096

# Memory limits (completo)
MemoryMax=6G
MemoryHigh=5G

# CPU limits (completo)
CPUQuota=400%

[Install]
WantedBy=multi-user.target
EOF

# Habilitar e iniciar serviço
systemctl daemon-reload
systemctl enable leaf-primary
systemctl start leaf-primary

# Configurar firewall avançado
echo "🔥 Configurando firewall avançado..."
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3000/tcp
ufw allow 3001/tcp
ufw --force enable

# Configurar fail2ban
echo "🛡️ Configurando fail2ban..."
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

[nginx-limit-req]
enabled = true
filter = nginx-limit-req
action = iptables-multiport[name=ReqLimit, port=http,https]
logpath = /var/log/nginx/error.log
maxretry = 5
EOF

systemctl enable fail2ban
systemctl start fail2ban

# Configurar monitoramento avançado
echo "📊 Configurando monitoramento avançado..."
cat > /usr/local/bin/vultr-monitor-completo.sh << 'EOF'
#!/bin/bash

# Monitoramento avançado para Vultr (completo)
LOG_FILE="/var/log/leaf-app/monitor.log"
ALERT_EMAIL="admin@leafapp.com"
VULTR_IP="216.238.107.59"
BACKUP_IP="147.93.66.253"

# Função de logging
log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> $LOG_FILE
}

# Verificar CPU
cpu_usage=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1)
if (( $(echo "$cpu_usage > 80" | bc -l) )); then
    log_message "ALERTA: CPU usage alto: ${cpu_usage}%"
    echo "ALERTA: CPU usage alto: ${cpu_usage}%" | mail -s "Leaf App - CPU Alert" $ALERT_EMAIL
fi

# Verificar RAM
ram_usage=$(free | awk 'NR==2{printf "%.0f", $3*100/$2}')
if [ $ram_usage -gt 80 ]; then
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

# Verificar espaço em disco
disk_usage=$(df / | awk 'NR==2{print $5}' | sed 's/%//')
if [ $disk_usage -gt 85 ]; then
    log_message "ALERTA: Disco usage alto: ${disk_usage}%"
    echo "ALERTA: Disco usage alto: ${disk_usage}%" | mail -s "Leaf App - Disk Alert" $ALERT_EMAIL
fi

log_message "Monitoramento executado com sucesso"
EOF

chmod +x /usr/local/bin/vultr-monitor-completo.sh

# Adicionar ao cron
echo "*/2 * * * * /usr/local/bin/vultr-monitor-completo.sh" | crontab -

# Criar diretório de logs
mkdir -p /var/log/leaf-app
chown $APP_USER:$APP_USER /var/log/leaf-app

# Configurar backup automático
echo "🔄 Configurando backup automático..."
cat > /usr/local/bin/backup-completo.sh << 'EOF'
#!/bin/bash

# Backup automático completo
BACKUP_DIR="/home/leaf/backups"
DATE=$(date +%Y%m%d-%H%M%S)

# Criar backup do Redis
redis-cli BGSAVE
sleep 5
cp /var/lib/redis/dump.rdb $BACKUP_DIR/redis-$DATE.rdb

# Criar backup da aplicação
tar -czf $BACKUP_DIR/app-$DATE.tar.gz /home/leaf/leaf-websocket-backend/

# Criar backup das configurações
tar -czf $BACKUP_DIR/config-$DATE.tar.gz /etc/nginx/ /etc/systemd/system/leaf-primary.service

# Limpar backups antigos (manter últimos 7 dias)
find $BACKUP_DIR -name "*.rdb" -mtime +7 -delete
find $BACKUP_DIR -name "*.tar.gz" -mtime +7 -delete

echo "Backup completo criado: $DATE"
EOF

chmod +x /usr/local/bin/backup-completo.sh

# Adicionar backup ao cron
echo "0 2 * * * /usr/local/bin/backup-completo.sh" | crontab -

# Configurar SSL/HTTPS
echo "🔒 Configurando SSL/HTTPS..."
apt install -y certbot python3-certbot-nginx

# Criar script de renovação SSL
cat > /usr/local/bin/renew-ssl.sh << 'EOF'
#!/bin/bash

# Script de renovação automática de SSL
echo "🔄 Renovando certificados SSL..."
certbot renew --quiet

# Reiniciar Nginx se certificados foram renovados
if [ $? -eq 0 ]; then
    echo "✅ Certificados renovados com sucesso"
    systemctl reload nginx
else
    echo "❌ Erro na renovação dos certificados"
fi
EOF

chmod +x /usr/local/bin/renew-ssl.sh

# Adicionar renovação SSL ao cron
echo "0 12 * * * /usr/local/bin/renew-ssl.sh" | crontab -

echo "✅ VULTR COMPLETO CONFIGURADO COM SUCESSO!"
echo "📊 Status: http://$VULTR_IP/health"
echo "🔧 Serviço: systemctl status leaf-primary"
echo "📝 Logs: journalctl -u leaf-primary -f"
echo "🛡️ Firewall: ufw status"
echo "📊 Monitoramento: tail -f /var/log/leaf-app/monitor.log"
echo "💰 Configuração completa ativa - 4 vCPU, 8GB RAM!"
echo ""
echo "🌐 IP da Vultr: $VULTR_IP"
echo "🔑 Senha Root: #9Nf@9)TGUG_cQ(+"
echo ""
echo "📋 Próximos passos:"
echo "   1. Configurar DNS: leafapp.com -> $VULTR_IP"
echo "   2. Obter certificado SSL: certbot --nginx -d leafapp.com"
echo "   3. Testar aplicação: curl http://$VULTR_IP/health" 