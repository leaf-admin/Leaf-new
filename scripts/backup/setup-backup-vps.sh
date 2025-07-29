#!/bin/bash

# 🚀 SCRIPT DE CONFIGURAÇÃO DA VPS DE BACKUP
# Data: 29 de Julho de 2025
# Autor: Leaf App Team

set -e

echo "🔧 CONFIGURANDO VPS DE BACKUP..."

# Verificar se está rodando como root
if [ "$EUID" -ne 0 ]; then
    echo "❌ Este script deve ser executado como root (sudo)"
    exit 1
fi

# Configurações
BACKUP_USER="leaf"
BACKUP_DIR="/home/$BACKUP_USER"
APP_DIR="$BACKUP_DIR/leaf-websocket-backend"

echo "📦 Atualizando sistema..."
apt update && apt upgrade -y

echo "📦 Instalando dependências..."
apt install -y curl wget git nginx redis-server nodejs npm

# Criar usuário leaf
echo "👤 Criando usuário leaf..."
useradd -m -s /bin/bash $BACKUP_USER || true
usermod -aG sudo $BACKUP_USER

# Configurar diretórios
echo "📁 Configurando diretórios..."
mkdir -p $BACKUP_DIR
chown $BACKUP_USER:$BACKUP_USER $BACKUP_DIR

# Clonar repositório
echo "📥 Clonando repositório..."
cd $BACKUP_DIR
if [ ! -d "leaf-websocket-backend" ]; then
    git clone https://github.com/leafapp/leaf-websocket-backend.git
fi

# Configurar Redis
echo "🔴 Configurando Redis..."
systemctl enable redis-server
systemctl start redis-server

# Configurar Nginx
echo "🌐 Configurando Nginx..."
cat > /etc/nginx/sites-available/leaf-backup << 'EOF'
server {
    listen 80;
    server_name backup.leafapp.com;
    
    location / {
        return 200 "Backup Server OK\n";
        add_header Content-Type text/plain;
    }
    
    location /health {
        return 200 "healthy\n";
        add_header Content-Type text/plain;
    }
}
EOF

ln -sf /etc/nginx/sites-available/leaf-backup /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
systemctl restart nginx

# Configurar aplicação
echo "⚙️ Configurando aplicação..."
cd $APP_DIR
npm install

# Criar arquivo de configuração
cat > $APP_DIR/config.env << 'EOF'
# Configurações do Servidor
PORT=3001

# Redis Configuration
REDIS_URL=redis://localhost:6379

# Firebase Configuration
FIREBASE_DATABASE_URL=https://leaf-reactnative-default-rtdb.firebaseio.com
FIREBASE_PROJECT_ID=leaf-reactnative

# Logs
LOG_LEVEL=info

# Backup Configuration
BACKUP_MODE=true
PRIMARY_SERVER=147.93.66.253
EOF

# Criar serviço systemd
echo "🔧 Criando serviço systemd..."
cat > /etc/systemd/system/leaf-backup.service << EOF
[Unit]
Description=Leaf App Backup Server
After=network.target redis-server.service

[Service]
Type=simple
User=$BACKUP_USER
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

# Habilitar e iniciar serviço
systemctl daemon-reload
systemctl enable leaf-backup
systemctl start leaf-backup

# Configurar firewall
echo "🔥 Configurando firewall..."
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3000/tcp
ufw allow 3001/tcp
ufw --force enable

# Configurar monitoramento
echo "📊 Configurando monitoramento..."
cat > /usr/local/bin/backup-health-check.sh << 'EOF'
#!/bin/bash

# Health check para VPS de backup
BACKUP_IP=$(hostname -I | awk '{print $1}')
PRIMARY_IP="147.93.66.253"

# Verificar se serviços estão rodando
if ! systemctl is-active --quiet leaf-backup; then
    echo "❌ Leaf backup service não está rodando"
    exit 1
fi

if ! systemctl is-active --quiet redis-server; then
    echo "❌ Redis não está rodando"
    exit 1
fi

if ! systemctl is-active --quiet nginx; then
    echo "❌ Nginx não está rodando"
    exit 1
fi

# Verificar conectividade com VPS principal
if ! ping -c 1 $PRIMARY_IP &> /dev/null; then
    echo "⚠️ VPS principal não responde"
fi

echo "✅ Backup VPS funcionando normalmente"
EOF

chmod +x /usr/local/bin/backup-health-check.sh

# Adicionar ao cron
echo "*/5 * * * * /usr/local/bin/backup-health-check.sh" | crontab -

echo "✅ VPS DE BACKUP CONFIGURADA COM SUCESSO!"
echo "📊 Status: http://$(hostname -I | awk '{print $1}')/health"
echo "🔧 Serviço: systemctl status leaf-backup"
echo "📝 Logs: journalctl -u leaf-backup -f" 