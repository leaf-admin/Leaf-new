#!/bin/bash

# 🚀 SCRIPT DE CONFIGURAÇÃO HOSTINGER FALLBACK
# Data: 29 de Julho de 2025
# Autor: Leaf App Team

set -e

echo "🔄 CONFIGURANDO HOSTINGER COMO FALLBACK..."

# Verificar se está rodando como root
if [ "$EUID" -ne 0 ]; then
    echo "❌ Este script deve ser executado como root (sudo)"
    exit 1
fi

# Configurações
APP_USER="leaf"
APP_DIR="/home/$APP_USER"
PRIMARY_IP="216.238.107.59"  # Vultr como servidor principal

echo "📦 Atualizando sistema..."
apt update && apt upgrade -y

echo "📦 Instalando dependências..."
apt install -y curl wget git nginx redis-server nodejs npm ufw fail2ban

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

# Configurar Redis otimizado para fallback
echo "🔴 Configurando Redis para fallback..."
cat > /etc/redis/redis.conf << 'EOF'
# Redis Configuration for Leaf App Fallback
bind 216.238.107.59
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
maxmemory 800mb
maxmemory-policy allkeys-lru
appendonly yes
appendfilename "appendonly.aof"
appendfsync everysec
no-appendfsync-on-rewrite no
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb
EOF

systemctl enable redis-server
systemctl restart redis-server

# Configurar Nginx para fallback
echo "🌐 Configurando Nginx para fallback..."
cat > /etc/nginx/sites-available/leaf-fallback << 'EOF'
server {
    listen 80;
    server_name backup.leafapp.com fallback.leafapp.com;
    
    # Health check
    location /health {
        access_log off;
        return 200 "fallback_healthy\n";
        add_header Content-Type text/plain;
    }
    
    # Status page
    location /status {
        access_log off;
        return 200 "Fallback Server Active\n";
        add_header Content-Type text/plain;
    }
    
    # API fallback (somente se principal estiver down)
    location /api/ {
        # Verificar se principal está up
        if ($http_x_forwarded_for ~* "primary") {
            return 503 "Primary server is available";
        }
        
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
    }
    
    # WebSocket fallback
    location /socket.io/ {
        # Verificar se principal está up
        if ($http_x_forwarded_for ~* "primary") {
            return 503 "Primary server is available";
        }
        
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
    
    # Default response
    location / {
        return 200 "Leaf App Fallback Server\n";
        add_header Content-Type text/plain;
    }
}
EOF

ln -sf /etc/nginx/sites-available/leaf-fallback /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Configurar aplicação
echo "⚙️ Configurando aplicação..."
cd $APP_DIR/leaf-websocket-backend
npm install

# Criar arquivo de configuração para fallback
cat > $APP_DIR/leaf-websocket-backend/config.env << 'EOF'
# Configurações do Servidor Fallback (Hostinger)
PORT=3001
NODE_ENV=production

# Redis Configuration (1GB RAM)
REDIS_URL=redis://localhost:6379
REDIS_MAX_MEMORY=800mb
REDIS_MAX_MEMORY_POLICY=allkeys-lru

# Firebase Configuration
FIREBASE_DATABASE_URL=https://leaf-reactnative-default-rtdb.firebaseio.com
FIREBASE_PROJECT_ID=leaf-reactnative

# Logs
LOG_LEVEL=info
LOG_ROTATION=5
LOG_MAX_SIZE=10mb

# Performance (limitado para fallback)
MAX_CONNECTIONS=1000
HEALTH_CHECK_INTERVAL=30000
RATE_LIMIT_WINDOW=60000
RATE_LIMIT_MAX=100

# Fallback Configuration
FALLBACK_MODE=true
PRIMARY_SERVER=216.238.107.59
FAILOVER_ENABLED=true
BACKUP_ONLY=true
EOF

# Criar serviço systemd para fallback
echo "🔧 Criando serviço systemd para fallback..."
cat > /etc/systemd/system/leaf-fallback.service << EOF
[Unit]
Description=Leaf App Fallback Server (Hostinger)
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

# Resource limits (limitado para fallback)
LimitNOFILE=2048
LimitNPROC=1024

# Memory limits
MemoryMax=1G
MemoryHigh=800M

# CPU limits
CPUQuota=100%

[Install]
WantedBy=multi-user.target
EOF

# Habilitar e iniciar serviço
systemctl daemon-reload
systemctl enable leaf-fallback
systemctl start leaf-fallback

# Configurar firewall
echo "🔥 Configurando firewall..."
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
EOF

systemctl enable fail2ban
systemctl start fail2ban

# Configurar monitoramento de fallback
echo "📊 Configurando monitoramento de fallback..."
cat > /usr/local/bin/fallback-monitor.sh << 'EOF'
#!/bin/bash

# Monitoramento para servidor de fallback
LOG_FILE="/var/log/leaf-app/fallback-monitor.log"
ALERT_EMAIL="admin@leafapp.com"
PRIMARY_IP="216.238.107.59"

# Função de logging
log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> $LOG_FILE
}

# Verificar se serviços estão rodando
if ! systemctl is-active --quiet leaf-fallback; then
    log_message "ERRO: Leaf fallback service down"
    echo "ERRO: Leaf fallback service down" | mail -s "Leaf App - Fallback Down" $ALERT_EMAIL
    systemctl restart leaf-fallback
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

# Verificar conectividade com servidor principal
if ping -c 1 $PRIMARY_IP > /dev/null 2>&1; then
    log_message "INFO: Primary server is reachable"
else
    log_message "ALERTA: Primary server não responde - fallback ativo"
    echo "ALERTA: Primary server não responde - fallback ativo" | mail -s "Leaf App - Fallback Active" $ALERT_EMAIL
fi

# Verificar uso de recursos
ram_usage=$(free | awk 'NR==2{printf "%.0f", $3*100/$2}')
if [ $ram_usage -gt 90 ]; then
    log_message "ALERTA: RAM usage alto: ${ram_usage}%"
    echo "ALERTA: RAM usage alto: ${ram_usage}%" | mail -s "Leaf App - RAM Alert" $ALERT_EMAIL
fi

log_message "Monitoramento de fallback executado com sucesso"
EOF

chmod +x /usr/local/bin/fallback-monitor.sh

# Adicionar ao cron
echo "*/5 * * * * /usr/local/bin/fallback-monitor.sh" | crontab -

# Criar diretório de logs
mkdir -p /var/log/leaf-app
chown $APP_USER:$APP_USER /var/log/leaf-app

# Configurar backup automático
echo "🔄 Configurando backup automático..."
cat > /usr/local/bin/fallback-backup.sh << 'EOF'
#!/bin/bash

# Backup automático para servidor de fallback
BACKUP_DIR="/home/leaf/backups"
DATE=$(date +%Y%m%d-%H%M%S)

# Criar backup do Redis
redis-cli BGSAVE
sleep 5
cp /var/lib/redis/dump.rdb $BACKUP_DIR/redis-fallback-$DATE.rdb

# Criar backup da aplicação
tar -czf $BACKUP_DIR/app-fallback-$DATE.tar.gz /home/leaf/leaf-websocket-backend/

# Limpar backups antigos (manter últimos 3 dias)
find $BACKUP_DIR -name "*.rdb" -mtime +3 -delete
find $BACKUP_DIR -name "*.tar.gz" -mtime +3 -delete

echo "Backup de fallback criado: $DATE"
EOF

chmod +x /usr/local/bin/fallback-backup.sh

# Adicionar backup ao cron
echo "0 3 * * * /usr/local/bin/fallback-backup.sh" | crontab -

echo "✅ HOSTINGER FALLBACK CONFIGURADO COM SUCESSO!"
echo "📊 Status: http://$(hostname -I | awk '{print $1}')/health"
echo "🔧 Serviço: systemctl status leaf-fallback"
echo "📝 Logs: journalctl -u leaf-fallback -f"
echo "🛡️ Firewall: ufw status"
echo "📊 Monitoramento: tail -f /var/log/leaf-app/fallback-monitor.log"
echo "🔄 Backup: /usr/local/bin/fallback-backup.sh" 