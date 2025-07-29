#!/bin/bash

# Load Balancer Setup
# Data: 29/07/2025
# Status: ✅ LOAD BALANCER

# Configurações
PRIMARY_SERVER="147.93.66.253:3000"
BACKUP_SERVER="147.93.66.254:3000"  # VPS de backup
WEBSOCKET_PRIMARY="147.93.66.253:3001"
WEBSOCKET_BACKUP="147.93.66.254:3001"

# Criar configuração do Load Balancer
cat > /etc/nginx/sites-available/load-balancer << 'EOF'
# LEAF APP - Load Balancer Configuration

# Upstream para API
upstream api_backend {
    # Health check
    server 147.93.66.253:3000 max_fails=3 fail_timeout=30s;
    server 147.93.66.254:3000 backup max_fails=3 fail_timeout=30s;
    
    # Configurações
    keepalive 32;
    keepalive_requests 100;
    keepalive_timeout 60s;
}

# Upstream para WebSocket
upstream websocket_backend {
    # Health check
    server 147.93.66.253:3001 max_fails=3 fail_timeout=30s;
    server 147.93.66.254:3001 backup max_fails=3 fail_timeout=30s;
    
    # Configurações
    keepalive 32;
    keepalive_requests 100;
    keepalive_timeout 60s;
}

server {
    listen 80;
    server_name leafapp.com www.leafapp.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name leafapp.com www.leafapp.com;
    
    # SSL Configuration
    ssl_certificate /etc/letsencrypt/live/leafapp.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/leafapp.com/privkey.pem;
    
    # Security Headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-XSS-Protection "1; mode=block" always;
    
    # Rate Limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    limit_req_zone $binary_remote_addr zone=auth:10m rate=5r/m;
    
    # API Routes - Load Balanced
    location /api/ {
        limit_req zone=api burst=20 nodelay;
        
        # Proxy to load balanced backend
        proxy_pass http://api_backend;
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
        
        # Health check
        proxy_next_upstream error timeout invalid_header http_500 http_502 http_503 http_504;
        proxy_next_upstream_tries 3;
        proxy_next_upstream_timeout 10s;
    }
    
    # WebSocket Routes - Load Balanced
    location /ws/ {
        limit_req zone=api burst=10 nodelay;
        
        # Proxy to load balanced WebSocket backend
        proxy_pass http://websocket_backend;
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
        
        # Health check
        proxy_next_upstream error timeout invalid_header http_500 http_502 http_503 http_504;
        proxy_next_upstream_tries 3;
        proxy_next_upstream_timeout 10s;
    }
    
    # Health Check Endpoint
    location /health {
        access_log off;
        return 200 "OK\n";
        add_header Content-Type text/plain;
    }
    
    # Load Balancer Status
    location /lb-status {
        stub_status on;
        access_log off;
        allow 127.0.0.1;
        deny all;
    }
}

# Monitoramento do Load Balancer
server {
    listen 8080;
    server_name localhost;
    
    location /lb-status {
        stub_status on;
        access_log off;
    }
    
    location /health {
        return 200 "Load Balancer OK\n";
        add_header Content-Type text/plain;
    }
}
EOF

echo "✅ Load Balancer configurado com:"
echo "   - Servidor Principal: $PRIMARY_SERVER"
echo "   - Servidor Backup: $BACKUP_SERVER"
echo "   - Health checks automáticos"
echo "   - Failover automático"
echo "   - Monitoramento em /lb-status" 