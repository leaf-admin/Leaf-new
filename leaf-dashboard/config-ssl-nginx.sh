#!/bin/bash

# 🔒 Script para configurar SSL no Dashboard Leaf
# Domínio: dashboard.leaf.app.br

set -e

VPS_IP="147.93.66.253"
VPS_USER="root"
VPS_PASSWORD="S-s'GZhsuMu3EI;-7ed1"
DOMAIN="dashboard.leaf.app.br"
DASHBOARD_PORT="3002"

echo "🔒 Configurando SSL para Dashboard Leaf"
echo "========================================"
echo "🌐 Domínio: $DOMAIN"
echo "📡 IP da VPS: $VPS_IP"
echo ""

# Verificar se sshpass está instalado
if ! command -v sshpass &> /dev/null; then
    echo "⚠️  sshpass não encontrado. Instalando..."
    sudo apt-get update -qq
    sudo apt-get install -y sshpass
fi

# Criar arquivo temporário com senha
SSHPASS_FILE=$(mktemp)
echo "$VPS_PASSWORD" > "$SSHPASS_FILE"
chmod 600 "$SSHPASS_FILE"

# Testar conexão
echo "🔍 Testando conexão..."
if ! sshpass -f "$SSHPASS_FILE" ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 $VPS_USER@$VPS_IP "echo 'Conexão OK'" 2>/dev/null; then
    echo "❌ Erro ao conectar na VPS"
    rm -f "$SSHPASS_FILE"
    exit 1
fi

echo "✅ Conectado na VPS"
echo ""

# Configurar Nginx e SSL
sshpass -f "$SSHPASS_FILE" ssh -o StrictHostKeyChecking=no $VPS_USER@$VPS_IP << EOF
    set -e
    
    echo "📝 Criando configuração Nginx para $DOMAIN..."
    
    # Criar configuração Nginx
    cat > /etc/nginx/sites-available/leaf-dashboard << NGINXEOF
# Configuração Nginx para Leaf Dashboard
# Domínio: $DOMAIN

server {
    listen 80;
    server_name $DOMAIN;
    
    # Redirecionar HTTP para HTTPS (após SSL ser configurado)
    # Por enquanto, proxy direto
    location / {
        proxy_pass http://localhost:$DASHBOARD_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 86400;
    }
    
    # API Routes
    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
    
    # WebSocket Routes
    location /socket.io/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
NGINXEOF

    # Habilitar site
    ln -sf /etc/nginx/sites-available/leaf-dashboard /etc/nginx/sites-enabled/leaf-dashboard 2>/dev/null || true
    
    # Testar configuração Nginx
    echo "🧪 Testando configuração Nginx..."
    nginx -t
    
    # Recarregar Nginx
    echo "🔄 Recarregando Nginx..."
    systemctl reload nginx
    
    echo "✅ Nginx configurado!"
    echo ""
    
    # Verificar se o domínio aponta para este servidor
    echo "🔍 Verificando DNS..."
    SERVER_IP=\$(curl -s ifconfig.me || curl -s ipinfo.io/ip)
    echo "   IP do servidor: \$SERVER_IP"
    
    # Tentar obter certificado SSL
    echo ""
    echo "🔒 Configurando SSL com Let's Encrypt..."
    echo "   ⚠️  IMPORTANTE: O domínio $DOMAIN precisa apontar para este IP antes de continuar!"
    echo ""
    read -p "   O domínio $DOMAIN está apontando para este servidor? (s/n): " -n 1 -r
    echo
    if [[ \$REPLY =~ ^[SsYy]$ ]]; then
        # Instalar certbot se não tiver
        if ! command -v certbot &> /dev/null; then
            echo "📦 Instalando Certbot..."
            apt-get update -qq
            apt-get install -y certbot python3-certbot-nginx
        fi
        
        # Obter certificado SSL
        echo "🔒 Obtendo certificado SSL..."
        certbot --nginx -d $DOMAIN --non-interactive --agree-tos --email suporte@leaf.app.br --redirect
        
        # Atualizar configuração Nginx para HTTPS
        echo "📝 Atualizando configuração Nginx para HTTPS..."
        cat > /etc/nginx/sites-available/leaf-dashboard << NGINXSSL
# Configuração Nginx para Leaf Dashboard com SSL
# Domínio: $DOMAIN

server {
    if (\$host = $DOMAIN) {
        return 301 https://\$host\$request_uri;
    }
    
    listen 80;
    server_name $DOMAIN;
    return 301 https://\$server_name\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name $DOMAIN;
    
    # SSL Configuration (gerado pelo Certbot)
    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    
    # Security Headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    
    # Dashboard Routes
    location / {
        proxy_pass http://localhost:$DASHBOARD_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 86400;
    }
    
    # API Routes
    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
    
    # WebSocket Routes
    location /socket.io/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
NGINXSSL
        
        # Testar e recarregar
        nginx -t
        systemctl reload nginx
        
        echo ""
        echo "✅ SSL configurado com sucesso!"
        echo "🌐 Acesse: https://$DOMAIN"
    else
        echo "⚠️  SSL não configurado. Configure o DNS primeiro e execute novamente."
        echo "🌐 Dashboard disponível em: http://$DOMAIN (sem SSL)"
    fi
EOF

rm -f "$SSHPASS_FILE"

echo ""
echo "✅ Configuração concluída!"
echo ""
echo "📋 Próximos passos:"
echo "   1. Configure o DNS: $DOMAIN → $VPS_IP"
echo "   2. Execute este script novamente para obter o certificado SSL"
echo "   3. Ou execute manualmente na VPS:"
echo "      certbot --nginx -d $DOMAIN"
echo ""
echo "🌐 URLs:"
echo "   HTTP:  http://$DOMAIN"
echo "   HTTPS: https://$DOMAIN (após configurar SSL)"


