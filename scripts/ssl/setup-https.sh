#!/bin/bash

# 🚀 SCRIPT DE CONFIGURAÇÃO HTTPS COM LET'S ENCRYPT
# Data: 29 de Julho de 2025
# Autor: Leaf App Team

set -e

echo "🔒 CONFIGURANDO HTTPS COM LET'S ENCRYPT..."

# Verificar se está rodando como root
if [ "$EUID" -ne 0 ]; then
    echo "❌ Este script deve ser executado como root (sudo)"
    exit 1
fi

# Configurações
DOMAIN="leafapp.com"
EMAIL="admin@leafapp.com"

echo "📦 Instalando Certbot..."
apt update
apt install -y certbot python3-certbot-nginx

echo "🌐 Configurando domínio..."
# Verificar se o domínio está apontando para este servidor
echo "⚠️ Certifique-se de que o domínio $DOMAIN está apontando para este servidor"
echo "📋 Verificando DNS..."
nslookup $DOMAIN

echo "🔒 Obtendo certificado SSL..."
certbot --nginx -d $DOMAIN -d www.$DOMAIN --email $EMAIL --agree-tos --non-interactive

echo "🔄 Configurando renovação automática..."
# Criar script de renovação
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

# Adicionar ao cron para renovação automática
echo "0 12 * * * /usr/local/bin/renew-ssl.sh" | crontab -

echo "🧪 Testando configuração SSL..."
nginx -t

if [ $? -eq 0 ]; then
    echo "✅ Configuração SSL válida!"
    systemctl reload nginx
    
    echo "🔒 HTTPS CONFIGURADO COM SUCESSO!"
    echo "🌐 URL: https://$DOMAIN"
    echo "📊 Status: https://$DOMAIN/health"
    echo "🔄 Renovação automática configurada"
    
else
    echo "❌ Erro na configuração SSL!"
    exit 1
fi

echo "✅ HTTPS CONFIGURADO COM SUCESSO!" 