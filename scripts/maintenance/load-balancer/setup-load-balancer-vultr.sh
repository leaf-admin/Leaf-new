#!/bin/bash

# 🚀 SCRIPT DE LOAD BALANCER - VULTR PRINCIPAL + HOSTINGER FALLBACK
# Data: 29 de Julho de 2025
# Autor: Leaf App Team

set -e

echo "⚖️ CONFIGURANDO LOAD BALANCER..."

# Verificar se está rodando como root
if [ "$EUID" -ne 0 ]; then
    echo "❌ Este script deve ser executado como root (sudo)"
    exit 1
fi

# Configurações
PRIMARY_IP="216.238.107.59"  # Vultr
BACKUP_IP="147.93.66.253"    # Hostinger
PRIMARY_PORT="443"
BACKUP_PORT="80"
HEALTH_CHECK_INTERVAL="30s"
FAIL_TIMEOUT="10s"
MAX_FAILS="3"

# Instalar dependências
echo "📦 Instalando dependências..."
apt update
apt install -y nginx apache2-utils

# Configurar upstream servers
echo "📝 Configurando upstream servers..."
cat > /etc/nginx/conf.d/upstream.conf << EOF
# Upstream configuration for Leaf App
upstream leaf_backend {
    # Primary server (Vultr)
    server $PRIMARY_IP:$PRIMARY_PORT max_fails=$MAX_FAILS fail_timeout=$FAIL_TIMEOUT;
    
    # Backup server (Hostinger)
    server $BACKUP_IP:$BACKUP_PORT max_fails=$MAX_FAILS fail_timeout=$FAIL_TIMEOUT backup;
    
    # Health check configuration
    keepalive 32;
}

# Rate limiting zones
limit_req_zone \$binary_remote_addr zone=api:10m rate=10r/s;
limit_req_zone \$binary_remote_addr zone=websocket:10m rate=100r/s;
limit_req_zone \$binary_remote_addr zone=health:10m rate=60r/s;
EOF

# Configurar site principal
echo "📝 Configurando site principal..."
cat > /etc/nginx/sites-available/leaf-load-balancer << EOF
# HTTP to HTTPS redirect
server {
    listen 80;
    server_name _;
    return 301 https://\$server_name\$request_uri;
}

# HTTPS Load Balancer
server {
    listen 443 ssl http2;
    server_name _;
    
    # SSL Configuration (self-signed for load balancer)
    ssl_certificate /etc/ssl/certs/nginx-selfsigned.crt;
    ssl_certificate_key /etc/ssl/private/nginx-selfsigned.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    
    # Security Headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    
    # Load Balancer Status Page
    location /lb-status {
        access_log off;
        allow 216.238.107.59;
        allow $PRIMARY_IP;
        deny all;
        
        stub_status on;
        add_header Content-Type text/plain;
    }
    
    # Health Check Endpoint
    location /health {
        access_log off;
        limit_req zone=health burst=10 nodelay;
        
        # Try primary first, then backup
        proxy_pass http://leaf_backend;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        # Health check specific headers
        proxy_set_header X-Health-Check "true";
        proxy_read_timeout 5;
        proxy_connect_timeout 5;
        proxy_send_timeout 5;
    }
    
    # WebSocket Endpoints
    location /socket.io/ {
        limit_req zone=websocket burst=50 nodelay;
        
        proxy_pass http://leaf_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 86400;
        proxy_buffering off;
        proxy_cache off;
        
        # WebSocket specific timeouts
        proxy_connect_timeout 10;
        proxy_send_timeout 10;
    }
    
    # API Endpoints
    location /api/ {
        limit_req zone=api burst=20 nodelay;
        
        proxy_pass http://leaf_backend;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 30;
        proxy_connect_timeout 30;
        proxy_send_timeout 30;
        
        # API specific headers
        add_header X-API-Version "1.0" always;
    }
    
    # Default location
    location / {
        proxy_pass http://leaf_backend;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 30;
        proxy_connect_timeout 30;
        proxy_send_timeout 30;
    }
    
    # Error pages
    error_page 502 503 504 /50x.html;
    location = /50x.html {
        root /usr/share/nginx/html;
        internal;
    }
}
EOF

# Gerar certificado SSL self-signed para o load balancer
echo "🔐 Gerando certificado SSL self-signed..."
mkdir -p /etc/ssl/private
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout /etc/ssl/private/nginx-selfsigned.key \
    -out /etc/ssl/certs/nginx-selfsigned.crt \
    -subj "/C=BR/ST=SP/L=Sao Paulo/O=Leaf App/CN=load-balancer.leafapp.com"

# Configurar firewall
echo "🔥 Configurando firewall..."
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# Configurar fail2ban
echo "🛡️ Configurando fail2ban..."
cat > /etc/fail2ban/jail.local << EOF
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 3

[nginx-http-auth]
enabled = true
filter = nginx-http-auth
logpath = /var/log/nginx/error.log
maxretry = 3

[nginx-limit-req]
enabled = true
filter = nginx-limit-req
logpath = /var/log/nginx/error.log
maxretry = 5
EOF

# Habilitar site e reiniciar Nginx
echo "🔄 Habilitando site e reiniciando Nginx..."
ln -sf /etc/nginx/sites-available/leaf-load-balancer /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Testar configuração
nginx -t

# Reiniciar serviços
systemctl restart nginx
systemctl restart fail2ban

# Configurar monitoramento do load balancer
echo "📊 Configurando monitoramento..."
cat > /usr/local/bin/lb-monitor.sh << 'EOF'
#!/bin/bash

# 📊 LOAD BALANCER MONITOR SCRIPT
# Data: 29 de Julho de 2025

LOG_FILE="/var/log/leaf-app/lb-monitor.log"
EMAIL_SCRIPT="/usr/local/bin/send-alert.sh"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a $LOG_FILE
}

send_alert() {
    local subject="$1"
    local message="$2"
    $EMAIL_SCRIPT "$subject" "$message"
}

# Verificar status dos upstreams
log "🔍 Verificando status dos upstreams..."

# Verificar primary (Vultr)
if curl -s --connect-timeout 5 https://216.238.107.59/health > /dev/null; then
    log "✅ Primary (Vultr) - OK"
    PRIMARY_STATUS="OK"
else
    log "❌ Primary (Vultr) - OFFLINE"
    PRIMARY_STATUS="OFFLINE"
    send_alert "ALERTA: Primary Offline" "Vultr (216.238.107.59) está offline em $(date)"
fi

# Verificar backup (Hostinger)
if curl -s --connect-timeout 5 http://147.93.66.253/health > /dev/null; then
    log "✅ Backup (Hostinger) - OK"
    BACKUP_STATUS="OK"
else
    log "❌ Backup (Hostinger) - OFFLINE"
    BACKUP_STATUS="OFFLINE"
    send_alert "ALERTA: Backup Offline" "Hostinger (147.93.66.253) está offline em $(date)"
fi

# Verificar load balancer
if curl -s --connect-timeout 5 https://localhost/health > /dev/null; then
    log "✅ Load Balancer - OK"
    LB_STATUS="OK"
else
    log "❌ Load Balancer - OFFLINE"
    LB_STATUS="OFFLINE"
    send_alert "CRÍTICO: Load Balancer Offline" "Load balancer está offline em $(date)"
fi

# Verificar Nginx
if systemctl is-active --quiet nginx; then
    log "✅ Nginx - OK"
else
    log "❌ Nginx - OFFLINE"
    systemctl restart nginx
    send_alert "ALERTA: Nginx Offline" "Nginx foi reiniciado em $(date)"
fi

log "✅ Monitoramento concluído"
EOF

chmod +x /usr/local/bin/lb-monitor.sh

# Configurar cron para monitoramento
(crontab -l 2>/dev/null; echo "*/2 * * * * /usr/local/bin/lb-monitor.sh") | crontab -

# Criar diretório de logs
mkdir -p /var/log/leaf-app

# Testar load balancer
echo "🧪 Testando load balancer..."
sleep 5
curl -s https://localhost/health

echo "✅ LOAD BALANCER CONFIGURADO COM SUCESSO!"
echo ""
echo "📊 RESUMO DA CONFIGURAÇÃO:"
echo "   - Primary: $PRIMARY_IP (Vultr)"
echo "   - Backup: $BACKUP_IP (Hostinger)"
echo "   - Health Check: A cada 30s"
echo "   - Fail Timeout: $FAIL_TIMEOUT"
echo "   - Max Fails: $MAX_FAILS"
echo ""
echo "🔧 COMANDOS ÚTEIS:"
echo "   - Status: curl https://localhost/lb-status"
echo "   - Health: curl https://localhost/health"
echo "   - Monitor: tail -f /var/log/leaf-app/lb-monitor.log"
echo "   - Nginx logs: tail -f /var/log/nginx/access.log"
echo ""
echo "🌐 TESTES:"
echo "   - Load Balancer: https://localhost/health"
echo "   - Primary: https://$PRIMARY_IP/health"
echo "   - Backup: http://$BACKUP_IP/health" 