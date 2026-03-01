#!/bin/bash

# 🚀 Script para fazer build e deploy do Dashboard na VPS
# Resolve problemas de compilação e deixa o dashboard mais rápido

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

echo -e "${BLUE}🚀 DEPLOY DASHBOARD PARA VPS${NC}"
echo "======================================"
echo -e "${YELLOW}🌐 VPS: ${VPS_IP}${NC}"
echo -e "${YELLOW}📁 Diretório: ${VPS_DASHBOARD_DIR}${NC}"
echo ""

# Verificar se está no diretório correto
if [ ! -f "package.json" ] || [ ! -d "src" ]; then
    echo -e "${RED}❌ Execute este script do diretório leaf-dashboard${NC}"
    exit 1
fi

# ===== PASSO 1: BUILD DE PRODUÇÃO =====
echo -e "${BLUE}📦 Fazendo build de produção...${NC}"

# Limpar builds anteriores
rm -rf .next out

# Fazer build
echo -e "${YELLOW}⏳ Compilando (isso pode levar alguns minutos)...${NC}"
npm run build

if [ ! -d ".next" ]; then
    echo -e "${RED}❌ Build falhou!${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Build concluído!${NC}"

# ===== PASSO 2: PREPARAR ARQUIVOS =====
echo -e "${BLUE}📦 Preparando arquivos para deploy...${NC}"

# Criar arquivo .env.production
cat > .env.production << EOF
NEXT_PUBLIC_API_URL=http://147.93.66.253:3001
NEXT_PUBLIC_WS_URL=ws://147.93.66.253:3001
EOF

# ===== PASSO 3: ENVIAR PARA VPS =====
echo -e "${BLUE}📤 Enviando para VPS...${NC}"

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
if ! sshpass -f "$SSHPASS_FILE" ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 $VPS_USER@$VPS_IP "echo 'Conexão OK'" 2>/dev/null; then
    echo -e "${RED}❌ Erro ao conectar na VPS${NC}"
    rm -f "$SSHPASS_FILE"
    exit 1
fi

# Criar diretório na VPS
sshpass -f "$SSHPASS_FILE" ssh -o StrictHostKeyChecking=no $VPS_USER@$VPS_IP "mkdir -p $VPS_DASHBOARD_DIR"

# Enviar arquivos necessários
echo -e "${YELLOW}📤 Enviando arquivos...${NC}"

# Enviar .next (build)
sshpass -f "$SSHPASS_FILE" rsync -avz --progress \
    --exclude 'node_modules' \
    --exclude '.git' \
    .next/ $VPS_USER@$VPS_IP:$VPS_DASHBOARD_DIR/.next/

# Enviar package.json e node_modules (ou instalar na VPS)
sshpass -f "$SSHPASS_FILE" scp -o StrictHostKeyChecking=no package.json $VPS_USER@$VPS_IP:$VPS_DASHBOARD_DIR/
sshpass -f "$SSHPASS_FILE" scp -o StrictHostKeyChecking=no package-lock.json $VPS_USER@$VPS_IP:$VPS_DASHBOARD_DIR/ 2>/dev/null || echo "package-lock.json não encontrado"

# Enviar .env.production
sshpass -f "$SSHPASS_FILE" scp -o StrictHostKeyChecking=no .env.production $VPS_USER@$VPS_IP:$VPS_DASHBOARD_DIR/.env.local

# Enviar next.config.js
sshpass -f "$SSHPASS_FILE" scp -o StrictHostKeyChecking=no next.config.js $VPS_USER@$VPS_IP:$VPS_DASHBOARD_DIR/

# Limpar arquivo temporário
rm -f "$SSHPASS_FILE"

echo -e "${GREEN}✅ Arquivos enviados!${NC}"

# ===== PASSO 4: INSTALAR E INICIAR NA VPS =====
echo -e "${BLUE}🔧 Configurando na VPS...${NC}"

sshpass -p "$VPS_PASSWORD" ssh -o StrictHostKeyChecking=no $VPS_USER@$VPS_IP << EOF
    cd $VPS_DASHBOARD_DIR
    
    # Instalar Node.js se não tiver
    if ! command -v node &> /dev/null; then
        echo "📦 Instalando Node.js..."
        curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
        apt-get install -y nodejs
    fi
    
    # Instalar dependências
    echo "📦 Instalando dependências..."
    npm install --production
    
    # Parar processo anterior se existir
    pm2 stop leaf-dashboard 2>/dev/null || pkill -f "next start" || true
    sleep 2
    
    # Iniciar com PM2
    echo "🚀 Iniciando dashboard..."
    pm2 start npm --name "leaf-dashboard" -- start
    pm2 save
    
    echo "✅ Dashboard iniciado!"
    pm2 status leaf-dashboard
EOF

echo -e "${GREEN}✅ Deploy concluído!${NC}"
echo ""
echo -e "${BLUE}📊 Informações:${NC}"
echo -e "   🌐 Dashboard: http://${VPS_IP}:${VPS_DASHBOARD_PORT}"
echo -e "   📁 Diretório: ${VPS_DASHBOARD_DIR}"
echo -e "   🔧 PM2: pm2 logs leaf-dashboard"
echo ""
echo -e "${YELLOW}💡 Próximos passos:${NC}"
echo -e "   1. Configurar Nginx para servir o dashboard"
echo -e "   2. Acessar: http://${VPS_IP}:${VPS_DASHBOARD_PORT}"


