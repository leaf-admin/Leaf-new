#!/bin/bash

# HTTPS Setup Script
# Data: 29/07/2025
# Status: ✅ HTTPS CONFIGURATION

# Configurações
DOMAIN="leafapp.com"
EMAIL="admin@leafapp.com"
NGINX_CONF="/etc/nginx/sites-available/leafapp"
SSL_DIR="/etc/letsencrypt/live/$DOMAIN"

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Função de logging
log_message() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')] $1${NC}"
}

log_error() {
    echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] WARNING: $1${NC}"
}

# Verificar se script está rodando como root
check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "Este script deve ser executado como root"
        exit 1
    fi
}

# Instalar dependências
install_dependencies() {
    log_message "Instalando dependências..."
    
    # Atualizar sistema
    apt update
    
    # Instalar nginx, certbot e outras dependências
    apt install -y nginx certbot python3-certbot-nginx ufw
    
    log_message "Dependências instaladas com sucesso"
}

# Configurar firewall
setup_firewall() {
    log_message "Configurando firewall..."
    
    # Permitir SSH
    ufw allow ssh
    
    # Permitir HTTP (temporário para certificado)
    ufw allow 80
    
    # Permitir HTTPS
    ufw allow 443
    
    # Ativar firewall
    ufw --force enable
    
    log_message "Firewall configurado"
}

# Criar configuração do Nginx
create_nginx_config() {
    log_message "Criando configuração do Nginx..."
    
    cat > $NGINX_CONF << 'EOF'
# LEAF APP - Nginx Configuration
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
    
    # SSL Security Settings
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
    
    # Rate Limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    limit_req_zone $binary_remote_addr zone=auth:10m rate=5r/m;
    
    # API Routes
    location /api/ {
        # Rate limiting
        limit_req zone=api burst=20 nodelay;
        
        # Proxy to Node.js API
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
    
    # WebSocket Routes
    location /ws/ {
        # Rate limiting
        limit_req zone=api burst=10 nodelay;
        
        # Proxy to WebSocket server
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket specific settings
        proxy_buffering off;
        proxy_cache off;
    }
    
    # Authentication Routes (stricter rate limiting)
    location /api/auth/ {
        limit_req zone=auth burst=5 nodelay;
        
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
    
    # Payment Routes (extra security)
    location /api/payment/ {
        limit_req zone=auth burst=3 nodelay;
        
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
    
    # Health Check
    location /health {
        access_log off;
        return 200 "OK\n";
        add_header Content-Type text/plain;
    }
    
    # Security: Block access to sensitive files
    location ~ /\. {
        deny all;
    }
    
    location ~ \.(htaccess|htpasswd|ini|log|sh|sql|conf)$ {
        deny all;
    }
    
    # Gzip compression
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
}
EOF
    
    log_message "Configuração do Nginx criada"
}

# Obter certificado SSL
get_ssl_certificate() {
    log_message "Obtendo certificado SSL..."
    
    # Verificar se domínio está configurado
    if ! nslookup $DOMAIN > /dev/null 2>&1; then
        log_error "Domínio $DOMAIN não está resolvendo. Configure o DNS primeiro."
        exit 1
    fi
    
    # Obter certificado com Certbot
    certbot --nginx -d $DOMAIN -d www.$DOMAIN --email $EMAIL --agree-tos --non-interactive
    
    if [ $? -eq 0 ]; then
        log_message "Certificado SSL obtido com sucesso"
    else
        log_error "Falha ao obter certificado SSL"
        exit 1
    fi
}

# Configurar renovação automática
setup_auto_renewal() {
    log_message "Configurando renovação automática do certificado..."
    
    # Adicionar cron job para renovação
    (crontab -l 2>/dev/null; echo "0 12 * * * /usr/bin/certbot renew --quiet") | crontab -
    
    # Testar renovação
    certbot renew --dry-run
    
    log_message "Renovação automática configurada"
}

# Configurar Node.js para HTTPS
setup_nodejs_https() {
    log_message "Configurando Node.js para HTTPS..."
    
    # Criar arquivo de configuração HTTPS para Node.js
    cat > /home/leaf/leaf-websocket-backend/https-config.js << 'EOF'
// HTTPS Configuration for Node.js
const https = require('https');
const fs = require('fs');

const httpsOptions = {
    cert: fs.readFileSync('/etc/letsencrypt/live/leafapp.com/fullchain.pem'),
    key: fs.readFileSync('/etc/letsencrypt/live/leafapp.com/privkey.pem'),
    ca: fs.readFileSync('/etc/letsencrypt/live/leafapp.com/chain.pem')
};

module.exports = httpsOptions;
EOF
    
    log_message "Configuração HTTPS do Node.js criada"
}

# Testar configuração
test_configuration() {
    log_message "Testando configuração..."
    
    # Testar Nginx
    nginx -t
    if [ $? -eq 0 ]; then
        log_message "Configuração do Nginx OK"
    else
        log_error "Erro na configuração do Nginx"
        exit 1
    fi
    
    # Testar SSL
    echo | openssl s_client -servername $DOMAIN -connect $DOMAIN:443 2>/dev/null | openssl x509 -noout -dates
    if [ $? -eq 0 ]; then
        log_message "Certificado SSL OK"
    else
        log_error "Erro no certificado SSL"
        exit 1
    fi
}

# Reiniciar serviços
restart_services() {
    log_message "Reiniciando serviços..."
    
    # Reiniciar Nginx
    systemctl restart nginx
    systemctl enable nginx
    
    # Verificar status
    if systemctl is-active --quiet nginx; then
        log_message "Nginx reiniciado com sucesso"
    else
        log_error "Falha ao reiniciar Nginx"
        exit 1
    fi
}

# Função principal
main() {
    log_message "=== CONFIGURAÇÃO HTTPS - LEAF APP ==="
    
    # Verificações
    check_root
    
    # Instalação e configuração
    install_dependencies
    setup_firewall
    create_nginx_config
    get_ssl_certificate
    setup_auto_renewal
    setup_nodejs_https
    
    # Testes
    test_configuration
    
    # Reiniciar serviços
    restart_services
    
    log_message "=== CONFIGURAÇÃO HTTPS CONCLUÍDA ==="
    log_message "🌐 Acesse: https://$DOMAIN"
    log_message "🔒 Certificado SSL configurado"
    log_message "🛡️ Firewall configurado"
    log_message "⚡ Rate limiting ativo"
    log_message "🔄 Renovação automática configurada"
}

# Executar função principal
main "$@" 