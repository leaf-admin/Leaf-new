#!/bin/bash

# 🚀 DEPLOY COMPLETO LEAF APP PARA HOSTINGER VPS
# Script para fazer deploy do servidor WebSocket completo na VPS da Hostinger

set -e

# 🔑 Configurações da VPS
VPS_IP="147.93.66.253"
VPS_USER="root"
VPS_PASSWORD="S-s'GZhsuMu3EI;-7ed1"
PROJECT_DIR="/opt/leaf-websocket-backend"
BACKEND_DIR="leaf-websocket-backend"

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() {
    echo -e "${BLUE}[$(date +'%H:%M:%S')]${NC} $1"
}

success() {
    echo -e "${GREEN}✅${NC} $1"
}

error() {
    echo -e "${RED}❌${NC} $1"
}

warning() {
    echo -e "${YELLOW}⚠️${NC} $1"
}

echo ""
echo "🚀 DEPLOY LEAF APP PARA HOSTINGER VPS"
echo "======================================"
echo "🌐 IP: $VPS_IP"
echo "👤 User: $VPS_USER"
echo "📁 Diretório: $PROJECT_DIR"
echo ""

# Verificar se o diretório do backend existe
if [ ! -d "$BACKEND_DIR" ]; then
    error "Diretório $BACKEND_DIR não encontrado!"
    exit 1
fi

# ===== PASSO 1: CONFIGURAR SSH =====
log "Configurando acesso SSH..."

# Criar arquivo temporário com senha para sshpass
SSHPASS_FILE=$(mktemp)
echo "$VPS_PASSWORD" > "$SSHPASS_FILE"
chmod 600 "$SSHPASS_FILE"

# Verificar se sshpass está instalado
if ! command -v sshpass &> /dev/null; then
    warning "sshpass não encontrado. Instalando..."
    sudo apt-get update -qq
    sudo apt-get install -y sshpass
fi

# Testar conexão SSH
log "Testando conexão SSH..."
if sshpass -f "$SSHPASS_FILE" ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 $VPS_USER@$VPS_IP "echo 'Conexão OK'" 2>/dev/null; then
    success "Conexão SSH estabelecida"
else
    error "Falha ao conectar via SSH. Verifique as credenciais."
    rm -f "$SSHPASS_FILE"
    exit 1
fi

# ===== PASSO 2: SETUP INICIAL DA VPS =====
log "Configurando ambiente na VPS..."

sshpass -f "$SSHPASS_FILE" ssh -o StrictHostKeyChecking=no $VPS_USER@$VPS_IP << 'EOF'
    set -e
    
    echo "📊 Verificando sistema..."
    echo "RAM: $(free -h | grep Mem | awk '{print $3"/"$2}')"
    echo "Disco: $(df -h / | tail -1 | awk '{print $3"/"$2}')"
    echo "CPU: $(nproc) cores"
    echo ""
    
    # Atualizar sistema
    echo "🔧 Atualizando sistema..."
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get upgrade -y -qq
    
    # Instalar dependências básicas
    echo "📦 Instalando dependências básicas..."
    apt-get install -y -qq curl wget git unzip software-properties-common apt-transport-https ca-certificates gnupg lsb-release build-essential
    
    # Instalar Node.js 18.x se não estiver instalado
    if ! command -v node &> /dev/null; then
        echo "🟢 Instalando Node.js 18.x..."
        curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
        apt-get install -y -qq nodejs
    else
        echo "✅ Node.js já instalado: $(node --version)"
    fi
    
    # Instalar Redis se não estiver instalado
    if ! command -v redis-server &> /dev/null; then
        echo "🔴 Instalando Redis..."
        apt-get install -y -qq redis-server
        
        # Configurar Redis
        sed -i 's/bind 127.0.0.1/bind 0.0.0.0/' /etc/redis/redis.conf 2>/dev/null || true
        sed -i 's/# requirepass foobared/requirepass leaf_redis_2024/' /etc/redis/redis.conf 2>/dev/null || true
        sed -i 's/maxmemory 256mb/maxmemory 2gb/' /etc/redis/redis.conf 2>/dev/null || true
        sed -i 's/maxmemory-policy noeviction/maxmemory-policy allkeys-lru/' /etc/redis/redis.conf 2>/dev/null || true
        
        systemctl enable redis-server
        systemctl restart redis-server
        echo "✅ Redis instalado e configurado"
    else
        echo "✅ Redis já instalado"
        systemctl restart redis-server
    fi
    
    # Instalar PM2 globalmente se não estiver instalado
    if ! command -v pm2 &> /dev/null; then
        echo "🚀 Instalando PM2..."
        npm install -g pm2
        pm2 startup systemd -u root --hp /root
        echo "✅ PM2 instalado"
    else
        echo "✅ PM2 já instalado: $(pm2 --version)"
    fi
    
    # Instalar Nginx se não estiver instalado
    if ! command -v nginx &> /dev/null; then
        echo "🌐 Instalando Nginx..."
        apt-get install -y -qq nginx
        systemctl enable nginx
        echo "✅ Nginx instalado"
    else
        echo "✅ Nginx já instalado"
    fi
    
    # Configurar firewall básico
    echo "🔒 Configurando firewall..."
    ufw --force allow 22/tcp
    ufw --force allow 80/tcp
    ufw --force allow 443/tcp
    ufw --force allow 3001/tcp
    ufw --force allow 6379/tcp
    ufw --force enable 2>/dev/null || true
    
    echo "✅ Ambiente configurado!"
EOF

success "Ambiente configurado na VPS"

# ===== PASSO 3: CRIAR DIRETÓRIO E UPLOAD DO CÓDIGO =====
log "Criando diretório do projeto e fazendo upload do código..."

sshpass -f "$SSHPASS_FILE" ssh -o StrictHostKeyChecking=no $VPS_USER@$VPS_IP "mkdir -p $PROJECT_DIR"

# Fazer upload do código (excluindo node_modules e arquivos desnecessários)
log "Fazendo upload do código..."
rsync -avz --progress \
    --exclude 'node_modules' \
    --exclude '.git' \
    --exclude '*.log' \
    --exclude '.env' \
    --exclude '*.md' \
    --exclude 'tests' \
    --exclude 'scripts/deploy' \
    -e "sshpass -f $SSHPASS_FILE ssh -o StrictHostKeyChecking=no" \
    $BACKEND_DIR/ $VPS_USER@$VPS_IP:$PROJECT_DIR/

success "Código enviado para VPS"

# ===== PASSO 4: CONFIGURAR PROJETO NA VPS =====
log "Configurando projeto na VPS..."

sshpass -f "$SSHPASS_FILE" ssh -o StrictHostKeyChecking=no $VPS_USER@$VPS_IP << EOF
    set -e
    
    cd $PROJECT_DIR
    
    echo "📦 Instalando dependências..."
    npm install --production --silent
    
    echo "🔐 Configurando variáveis de ambiente..."
    
    # Criar .env se não existir
    if [ ! -f .env ]; then
        cat > .env << 'ENV_EOF'
# 🌿 LEAF APP - CONFIGURAÇÃO PRODUÇÃO
NODE_ENV=production
PORT=3001
WS_PORT=3001

# 🔴 Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=leaf_redis_2024
REDIS_DB=0

# 🔥 Firebase (configurar com suas credenciais)
FIREBASE_PROJECT_ID=leaf-app-91dfdce0
FIREBASE_PRIVATE_KEY=
FIREBASE_CLIENT_EMAIL=

# 🔑 API Keys
GOOGLE_MAPS_API_KEY=
MAPBOX_API_KEY=
LOCATIONIQ_API_KEY=

# 🔒 Segurança
CORS_ORIGIN=*
JWT_SECRET=leaf_jwt_secret_change_in_production_2024

# 📊 Monitoramento
LOG_LEVEL=info
ENABLE_METRICS=true

# 🌐 Servidor
HOST=0.0.0.0
ENV_EOF
        echo "✅ Arquivo .env criado"
    else
        echo "✅ Arquivo .env já existe"
    fi
    
    echo "✅ Projeto configurado!"
EOF

success "Projeto configurado na VPS"

# ===== PASSO 5: CONFIGURAR NGINX =====
log "Configurando Nginx como reverse proxy..."

sshpass -f "$SSHPASS_FILE" ssh -o StrictHostKeyChecking=no $VPS_USER@$VPS_IP << EOF
    cat > /etc/nginx/sites-available/leaf-app << 'NGINX_EOF'
server {
    listen 80;
    server_name $VPS_IP;

    # Logs
    access_log /var/log/nginx/leaf-app-access.log;
    error_log /var/log/nginx/leaf-app-error.log;

    # Tamanho máximo de upload
    client_max_body_size 10M;

    # WebSocket e API
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        
        # Headers para WebSocket
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        # Timeouts para WebSocket
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
        proxy_connect_timeout 60;
    }

    # Health check
    location /health {
        proxy_pass http://localhost:3001/health;
        access_log off;
    }

    # GraphQL
    location /graphql {
        proxy_pass http://localhost:3001/graphql;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }
}
NGINX_EOF

    # Criar link simbólico
    ln -sf /etc/nginx/sites-available/leaf-app /etc/nginx/sites-enabled/
    
    # Remover default se existir
    rm -f /etc/nginx/sites-enabled/default
    
    # Testar configuração
    nginx -t
    
    # Recarregar Nginx
    systemctl reload nginx
    
    echo "✅ Nginx configurado!"
EOF

success "Nginx configurado"

# ===== PASSO 6: INICIAR SERVIDOR COM PM2 =====
log "Iniciando servidor com PM2..."

sshpass -f "$SSHPASS_FILE" ssh -o StrictHostKeyChecking=no $VPS_USER@$VPS_IP << EOF
    cd $PROJECT_DIR
    
    # Parar instância anterior se existir
    pm2 delete leaf-websocket 2>/dev/null || true
    
    # Iniciar servidor
    echo "🚀 Iniciando servidor Leaf WebSocket..."
    pm2 start server.js --name leaf-websocket --max-memory-restart 2G
    
    # Salvar configuração PM2
    pm2 save
    
    # Configurar PM2 para iniciar no boot
    pm2 startup systemd -u root --hp /root 2>/dev/null || true
    
    echo "✅ Servidor iniciado!"
    
    # Mostrar status
    sleep 2
    pm2 status
EOF

success "Servidor iniciado com PM2"

# ===== PASSO 7: VERIFICAÇÃO FINAL =====
log "Verificando deploy..."

sleep 5

# Testar health check
log "Testando health check..."
if curl -s -f "http://$VPS_IP/health" > /dev/null; then
    success "Health check: OK"
else
    warning "Health check: Não respondeu (pode estar inicializando)"
fi

# Limpar arquivo temporário
rm -f "$SSHPASS_FILE"

# ===== RESUMO FINAL =====
echo ""
echo "🎯 DEPLOY CONCLUÍDO!"
echo "===================="
echo ""
echo "📊 INFORMAÇÕES DO SERVIDOR:"
echo "==========================="
echo "🌐 IP: $VPS_IP"
echo "📁 Diretório: $PROJECT_DIR"
echo "🔗 API: http://$VPS_IP"
echo "🔗 Health: http://$VPS_IP/health"
echo "🔗 GraphQL: http://$VPS_IP/graphql"
echo "🔌 WebSocket: ws://$VPS_IP"
echo ""
echo "🔧 COMANDOS ÚTEIS:"
echo "=================="
echo "ssh $VPS_USER@$VPS_IP"
echo "cd $PROJECT_DIR"
echo "pm2 status              # Ver status"
echo "pm2 logs leaf-websocket # Ver logs"
echo "pm2 restart leaf-websocket # Reiniciar"
echo "pm2 stop leaf-websocket    # Parar"
echo ""
echo "📝 PRÓXIMOS PASSOS:"
echo "==================="
echo "1. Configure as variáveis de ambiente em $PROJECT_DIR/.env"
echo "2. Adicione credenciais do Firebase"
echo "3. Adicione API keys (Google Maps, etc)"
echo "4. Reinicie o servidor: pm2 restart leaf-websocket"
echo ""
echo "✅ Deploy concluído com sucesso!"

