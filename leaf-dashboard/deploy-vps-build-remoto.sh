#!/bin/bash

# 🚀 Script para fazer build e deploy do Dashboard na VPS
# Faz build diretamente na VPS (resolve problemas de permissão)

set -e

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

VPS_IP="147.93.66.253"
VPS_USER="root"
VPS_PASSWORD="S-s'GZhsuMu3EI;-7ed1"
VPS_DASHBOARD_DIR="/opt/leaf-dashboard"
VPS_DASHBOARD_PORT="3002"

echo -e "${BLUE}🚀 DEPLOY DASHBOARD PARA VPS (BUILD REMOTO)${NC}"
echo "======================================"
echo -e "${YELLOW}🌐 VPS: ${VPS_IP}${NC}"
echo -e "${YELLOW}📁 Diretório: ${VPS_DASHBOARD_DIR}${NC}"
echo ""

# Verificar se está no diretório correto
if [ ! -f "package.json" ] || [ ! -d "src" ]; then
    echo -e "${RED}❌ Execute este script do diretório leaf-dashboard${NC}"
    exit 1
fi

# Verificar se sshpass está instalado
if ! command -v sshpass &> /dev/null; then
    echo -e "${YELLOW}⚠️  sshpass não encontrado. Instalando...${NC}"
    sudo apt-get update -qq
    sudo apt-get install -y sshpass
fi

# Criar arquivo temporário com senha
SSHPASS_FILE=$(mktemp)
echo "$VPS_PASSWORD" > "$SSHPASS_FILE"
chmod 600 "$SSHPASS_FILE"

# Testar conexão
echo -e "${BLUE}🔍 Testando conexão...${NC}"
if ! sshpass -f "$SSHPASS_FILE" ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 $VPS_USER@$VPS_IP "echo 'Conexão OK'" 2>/dev/null; then
    echo -e "${RED}❌ Erro ao conectar na VPS${NC}"
    rm -f "$SSHPASS_FILE"
    exit 1
fi

echo -e "${GREEN}✅ Conectado na VPS${NC}"

# ===== PASSO 1: ENVIAR CÓDIGO FONTE =====
echo -e "${BLUE}📤 Enviando código fonte para VPS...${NC}"

# Criar diretório na VPS
sshpass -f "$SSHPASS_FILE" ssh -o StrictHostKeyChecking=no $VPS_USER@$VPS_IP "mkdir -p $VPS_DASHBOARD_DIR"

# Enviar arquivos (excluindo node_modules e .next)
echo -e "${YELLOW}⏳ Enviando arquivos (isso pode levar alguns minutos)...${NC}"

sshpass -f "$SSHPASS_FILE" rsync -avz --progress \
    --exclude 'node_modules' \
    --exclude '.next' \
    --exclude '.git' \
    --exclude 'out' \
    --exclude '.env.local' \
    --exclude 'dashboard.log' \
    ./ $VPS_USER@$VPS_IP:$VPS_DASHBOARD_DIR/

echo -e "${GREEN}✅ Arquivos enviados!${NC}"

# ===== PASSO 2: BUILD E CONFIGURAÇÃO NA VPS =====
echo -e "${BLUE}🔧 Configurando e fazendo build na VPS...${NC}"

sshpass -f "$SSHPASS_FILE" ssh -o StrictHostKeyChecking=no $VPS_USER@$VPS_IP << EOF
    set -e
    cd $VPS_DASHBOARD_DIR
    
    # Instalar Node.js 18 se não tiver
    if ! command -v node &> /dev/null; then
        echo "📦 Instalando Node.js 18..."
        curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
        apt-get install -y nodejs
    fi
    
    # Verificar versão
    echo "✅ Node.js: \$(node --version)"
    echo "✅ npm: \$(npm --version)"
    
    # Criar .env.local
    cat > .env.local << ENVEOF
NEXT_PUBLIC_API_URL=http://147.93.66.253:3001
NEXT_PUBLIC_WS_URL=ws://147.93.66.253:3001
ENVEOF
    
    # Limpar builds anteriores
    rm -rf .next out node_modules
    
    # Instalar dependências
    echo "📦 Instalando dependências..."
    npm install
    
    # Fazer build de produção
    echo "🔨 Fazendo build de produção (isso pode levar alguns minutos)..."
    npm run build
    
    if [ ! -d ".next" ]; then
        echo "❌ Build falhou!"
        exit 1
    fi
    
    echo "✅ Build concluído!"
    
    # Instalar PM2 se não tiver
    if ! command -v pm2 &> /dev/null; then
        echo "📦 Instalando PM2..."
        npm install -g pm2
    fi
    
    # Parar processo anterior se existir
    pm2 stop leaf-dashboard 2>/dev/null || pkill -f "next start" || true
    sleep 2
    
    # Iniciar com PM2
    echo "🚀 Iniciando dashboard..."
    PORT=$VPS_DASHBOARD_PORT pm2 start npm --name "leaf-dashboard" -- start
    pm2 save
    
    echo "✅ Dashboard iniciado!"
    pm2 status leaf-dashboard
EOF

# Limpar arquivo temporário
rm -f "$SSHPASS_FILE"

echo ""
echo -e "${GREEN}🎉 DEPLOY CONCLUÍDO!${NC}"
echo ""
echo -e "${BLUE}📊 Informações:${NC}"
echo -e "   🌐 Dashboard: http://${VPS_IP}:${VPS_DASHBOARD_PORT}"
echo -e "   📁 Diretório: ${VPS_DASHBOARD_DIR}"
echo -e "   🔧 PM2: pm2 logs leaf-dashboard"
echo ""
echo -e "${YELLOW}💡 Testar:${NC}"
echo -e "   curl http://${VPS_IP}:${VPS_DASHBOARD_PORT}"


