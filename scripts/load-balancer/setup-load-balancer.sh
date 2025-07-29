#!/bin/bash

# 🚀 SCRIPT DE CONFIGURAÇÃO DO LOAD BALANCER
# Data: 29 de Julho de 2025
# Autor: Leaf App Team

set -e

echo "🔧 CONFIGURANDO LOAD BALANCER NGINX..."

# Verificar se está rodando como root
if [ "$EUID" -ne 0 ]; then
    echo "❌ Este script deve ser executado como root (sudo)"
    exit 1
fi

# Instalar Nginx se não estiver instalado
if ! command -v nginx &> /dev/null; then
    echo "📦 Instalando Nginx..."
    apt update
    apt install -y nginx
fi

# Criar configuração do load balancer
cat > /etc/nginx/sites-available/leaf-load-balancer << 'EOF'
upstream leaf_backend {
    # VPS Principal (Hostinger)
    server 147.93.66.253:3000 weight=3 max_fails=3 fail_timeout=30s;
    
    # VPS de Backup (Vultr São Paulo)
    server BACKUP_VPS_IP:3000 weight=1 max_fails=3 fail_timeout=30s backup;
    
    # Health check
    keepalive 32;
}

upstream leaf_websocket {
    # VPS Principal (Hostinger)
    server 147.93.66.253:3001 weight=3 max_fails=3 fail_timeout=30s;
    
    # VPS de Backup (Vultr São Paulo)
    server BACKUP_VPS_IP:3001 weight=1 max_fails=3 fail_timeout=30s backup;
    
    # Health check
    keepalive 32;
}

# Configuração do servidor HTTP
server {
    listen 80;
    server_name leafapp.com www.leafapp.com;
    
    # Redirecionar para HTTPS
    return 301 https://$server_name$request_uri;
}

# Configuração do servidor HTTPS
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
    
    # Rate Limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    limit_req_zone $binary_remote_addr zone=websocket:10m rate=5r/s;
    
    # API Endpoints
    location /api/ {
        limit_req zone=api burst=20 nodelay;
        
        proxy_pass http://leaf_backend;
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
    
    # WebSocket Endpoints
    location /socket.io/ {
        limit_req zone=websocket burst=10 nodelay;
        
        proxy_pass http://leaf_websocket;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
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
    
    # Gzip Compression
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

# Habilitar o site
ln -sf /etc/nginx/sites-available/leaf-load-balancer /etc/nginx/sites-enabled/

# Remover site padrão
rm -f /etc/nginx/sites-enabled/default

# Testar configuração
echo "🧪 Testando configuração do Nginx..."
nginx -t

if [ $? -eq 0 ]; then
    echo "✅ Configuração do Nginx válida!"
    
    # Reiniciar Nginx
    systemctl restart nginx
    systemctl enable nginx
    
    echo "🚀 Load Balancer configurado com sucesso!"
    echo "📊 Status: http://localhost/lb-status"
    echo "🏥 Health: http://localhost/health"
    
else
    echo "❌ Erro na configuração do Nginx!"
    exit 1
fi

echo "✅ LOAD BALANCER CONFIGURADO COM SUCESSO!" 