#!/bin/bash

# 🚀 SETUP VPS DEDICADA PARA KYC
# Configuração completa da VPS para processamento KYC

set -e

VPS_IP="147.93.66.253"
VPS_USER="root"
VPS_HOST="srv710490.hstgr.cloud"
APP_DIR="/opt/leaf-kyc-service"
SERVICE_USER="leaf-kyc"

echo "🚀 Iniciando setup da VPS KYC..."
echo "📍 IP: $VPS_IP"
echo "🏠 Host: $VPS_HOST"
echo ""

# Verificar se está rodando como root
if [ "$EUID" -ne 0 ]; then 
  echo "❌ Por favor, execute como root ou com sudo"
  exit 1
fi

# 1. Atualizar sistema
echo "📦 Atualizando sistema..."
apt-get update
apt-get upgrade -y

# 2. Instalar dependências do sistema
echo "📦 Instalando dependências do sistema..."
apt-get install -y \
  curl \
  wget \
  git \
  build-essential \
  python3 \
  python3-pip \
  cmake \
  pkg-config \
  libopencv-dev \
  libjpeg-dev \
  libpng-dev \
  libtiff-dev \
  libavcodec-dev \
  libavformat-dev \
  libswscale-dev \
  libv4l-dev \
  libxvidcore-dev \
  libx264-dev \
  libgtk-3-dev \
  libatlas-base-dev \
  gfortran \
  nginx \
  certbot \
  python3-certbot-nginx

# 3. Verificar Node.js e npm
echo "📦 Verificando Node.js e npm..."
if command -v node &> /dev/null; then
  NODE_VERSION=$(node -v)
  echo "✅ Node.js já instalado: $NODE_VERSION"
  
  # Verificar se npm está disponível (Node.js 18+ geralmente vem com npm)
  if command -v npm &> /dev/null; then
    echo "✅ npm já instalado: $(npm -v)"
  else
    echo "⚠️ npm não encontrado, mas Node.js geralmente inclui npm"
    echo "   Tentando usar npx ou instalar npm via corepack..."
    corepack enable 2>/dev/null || echo "   Corepack não disponível, continuando..."
  fi
else
  echo "❌ Node.js não encontrado. Instalando..."
  curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
  apt-get install -y nodejs
  echo "✅ Node.js $(node -v) instalado"
  echo "✅ npm $(npm -v) instalado"
fi

# 4. Criar usuário para o serviço
echo "👤 Criando usuário do serviço..."
if ! id "$SERVICE_USER" &>/dev/null; then
  useradd -r -s /bin/bash -d "$APP_DIR" -m "$SERVICE_USER"
  echo "✅ Usuário $SERVICE_USER criado"
else
  echo "⚠️ Usuário $SERVICE_USER já existe"
fi

# 5. Criar diretório da aplicação
echo "📁 Criando diretório da aplicação..."
mkdir -p "$APP_DIR"
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"

# 6. Instalar PM2 globalmente
echo "📦 Instalando PM2..."
npm install -g pm2

# 7. Configurar firewall
echo "🔥 Configurando firewall..."
if command -v ufw &> /dev/null; then
  ufw allow 22/tcp
  ufw allow 3002/tcp
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw --force enable
  echo "✅ Firewall configurado"
else
  echo "⚠️ UFW não encontrado, pulando configuração de firewall"
fi

# 8. Criar estrutura de diretórios
echo "📁 Criando estrutura de diretórios..."
sudo -u "$SERVICE_USER" mkdir -p "$APP_DIR"/{logs,uploads,temp,models}

# 9. Criar arquivo .env template
echo "📝 Criando arquivo .env template..."
cat > "$APP_DIR/.env.example" << EOF
# KYC VPS Configuration
NODE_ENV=production
PORT=3002
HOST=0.0.0.0

# API Security
API_KEY=CHANGE_THIS_TO_A_SECURE_RANDOM_STRING

# Firebase (para baixar imagens)
FIREBASE_PROJECT_ID=leaf-app-12345
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk@leaf-app-12345.iam.gserviceaccount.com

# Redis (opcional, para cache)
REDIS_URL=redis://localhost:6379

# Logging
LOG_LEVEL=info
LOG_DIR=./logs

# Performance
MAX_CONCURRENT_REQUESTS=5
REQUEST_TIMEOUT=30000
WORKER_THREADS=2

# Face Recognition
FACE_MATCH_THRESHOLD=0.6
LIVENESS_DETECTION_ENABLED=true
EOF

# 10. Criar script de inicialização systemd
echo "⚙️ Criando serviço systemd..."
cat > /etc/systemd/system/leaf-kyc.service << EOF
[Unit]
Description=Leaf KYC Service
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=leaf-kyc

# Security
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$APP_DIR

# Resource limits
LimitNOFILE=65536
LimitNPROC=4096

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
echo "✅ Serviço systemd criado"

# 11. Configurar Nginx (opcional, para HTTPS)
echo "🌐 Configurando Nginx..."
cat > /etc/nginx/sites-available/leaf-kyc << EOF
server {
    listen 80;
    server_name $VPS_HOST;

    location / {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        
        # Timeout para processamento KYC
        proxy_read_timeout 300s;
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
    }
}
EOF

# Criar link simbólico se não existir
if [ ! -L /etc/nginx/sites-enabled/leaf-kyc ]; then
  ln -s /etc/nginx/sites-available/leaf-kyc /etc/nginx/sites-enabled/
fi

# Testar configuração do Nginx
nginx -t && systemctl reload nginx || echo "⚠️ Erro na configuração do Nginx"

echo "✅ Nginx configurado"

# 12. Resumo
echo ""
echo "✅ SETUP CONCLUÍDO!"
echo ""
echo "📋 Próximos passos:"
echo "   1. Copiar arquivos da aplicação para $APP_DIR"
echo "   2. Configurar arquivo .env em $APP_DIR/.env"
echo "   3. Instalar dependências: cd $APP_DIR && npm install"
echo "   4. Iniciar serviço: systemctl start leaf-kyc"
echo "   5. Habilitar no boot: systemctl enable leaf-kyc"
echo ""
echo "🔧 Comandos úteis:"
echo "   - Ver logs: journalctl -u leaf-kyc -f"
echo "   - Reiniciar: systemctl restart leaf-kyc"
echo "   - Status: systemctl status leaf-kyc"
echo ""

