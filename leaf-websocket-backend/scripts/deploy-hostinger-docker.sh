#!/bin/bash

# 🚀 DEPLOY LEAF APP - HOSTINGER VPS COM DOCKER
# Script completo de deploy com Docker Compose

set -e

# ===== CONFIGURAÇÕES =====
VPS_IP="147.93.66.253"
VPS_USER="root"
VPS_SSH_KEY=""
APP_DIR="/opt/leaf-app"
PROJECT_DIR="leaf-websocket-backend"

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🚀 DEPLOY LEAF APP - HOSTINGER VPS${NC}"
echo "=========================================="
echo -e "📍 IP: ${YELLOW}$VPS_IP${NC}"
echo -e "📁 Diretório: ${YELLOW}$APP_DIR${NC}"
echo ""

# ===== FUNÇÃO: Verificar pré-requisitos =====
check_prerequisites() {
    echo -e "${BLUE}🔍 Verificando pré-requisitos...${NC}"
    
    # Verificar se estamos no diretório correto
    if [ ! -f "package.json" ] || [ ! -f "Dockerfile" ]; then
        echo -e "${RED}❌ Execute este script do diretório leaf-websocket-backend${NC}"
        exit 1
    fi
    
    # Verificar se docker-compose.hostinger.yml existe
    if [ ! -f "docker-compose.hostinger.yml" ]; then
        echo -e "${RED}❌ docker-compose.hostinger.yml não encontrado${NC}"
        exit 1
    fi
    
    # Verificar se firebase-credentials.json existe
    if [ ! -f "firebase-credentials.json" ]; then
        echo -e "${YELLOW}⚠️  firebase-credentials.json não encontrado${NC}"
        echo -e "${YELLOW}   Você precisará copiar manualmente para $APP_DIR${NC}"
    fi
    
    echo -e "${GREEN}✅ Pré-requisitos OK${NC}"
    echo ""
}

# ===== FUNÇÃO: Instalar Docker na VPS =====
install_docker() {
    echo -e "${BLUE}🐳 Instalando Docker na VPS...${NC}"
    
    ssh $VPS_USER@$VPS_IP << 'EOF'
        # Verificar se Docker já está instalado
        if command -v docker &> /dev/null; then
            echo "✅ Docker já está instalado: $(docker --version)"
        else
            echo "📦 Instalando Docker..."
            curl -fsSL https://get.docker.com -o get-docker.sh
            sh get-docker.sh
            rm get-docker.sh
            
            # Iniciar e habilitar Docker
            systemctl start docker
            systemctl enable docker
            
            echo "✅ Docker instalado: $(docker --version)"
        fi
        
        # Verificar se Docker Compose está instalado
        if command -v docker-compose &> /dev/null; then
            echo "✅ Docker Compose já está instalado: $(docker-compose --version)"
        else
            echo "📦 Instalando Docker Compose..."
            curl -L "https://github.com/docker/compose/releases/download/v2.24.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
            chmod +x /usr/local/bin/docker-compose
            echo "✅ Docker Compose instalado: $(docker-compose --version)"
        fi
        
        # Verificar se Docker está rodando
        if ! systemctl is-active --quiet docker; then
            echo "🔄 Iniciando Docker..."
            systemctl start docker
            sleep 3
        fi
        
        echo "✅ Docker está rodando"
EOF
    
    echo -e "${GREEN}✅ Docker instalado e configurado${NC}"
    echo ""
}

# ===== FUNÇÃO: Criar estrutura de diretórios =====
setup_directories() {
    echo -e "${BLUE}📁 Criando estrutura de diretórios...${NC}"
    
    ssh $VPS_USER@$VPS_IP << EOF
        mkdir -p $APP_DIR
        mkdir -p $APP_DIR/logs
        mkdir -p $APP_DIR/ssl
        chmod 755 $APP_DIR
        echo "✅ Estrutura criada em $APP_DIR"
EOF
    
    echo -e "${GREEN}✅ Diretórios criados${NC}"
    echo ""
}

# ===== FUNÇÃO: Copiar arquivos para VPS =====
copy_files() {
    echo -e "${BLUE}📦 Copiando arquivos para VPS...${NC}"
    
    # Criar arquivo .env de exemplo se não existir
    if [ ! -f ".env.production" ]; then
        echo -e "${YELLOW}⚠️  .env.production não encontrado, usando template...${NC}"
        if [ -f ".env.production.template" ]; then
            cp .env.production.template .env.production
            echo -e "${GREEN}✅ .env.production criado a partir do template${NC}"
        else
            echo -e "${YELLOW}⚠️  Template não encontrado, continuando sem .env.production${NC}"
            echo -e "${YELLOW}   Você precisará criar manualmente na VPS${NC}"
        fi
    fi
    
    # Copiar arquivos essenciais
    echo "📤 Copiando arquivos..."
    scp docker-compose.hostinger.yml $VPS_USER@$VPS_IP:$APP_DIR/docker-compose.yml
    scp Dockerfile $VPS_USER@$VPS_IP:$APP_DIR/
    scp package.json $VPS_USER@$VPS_IP:$APP_DIR/
    scp package-lock.json $VPS_USER@$VPS_IP:$APP_DIR/ 2>/dev/null || echo "⚠️  package-lock.json não encontrado, continuando..."
    scp nginx.conf $VPS_USER@$VPS_IP:$APP_DIR/
    
    # Copiar .env se existir
    if [ -f ".env.production" ]; then
        scp .env.production $VPS_USER@$VPS_IP:$APP_DIR/.env
        echo "✅ .env copiado"
    else
        echo -e "${YELLOW}⚠️  .env.production não encontrado, você precisará criar manualmente${NC}"
    fi
    
    # Copiar firebase-credentials.json se existir
    if [ -f "firebase-credentials.json" ]; then
        scp firebase-credentials.json $VPS_USER@$VPS_IP:$APP_DIR/
        echo "✅ firebase-credentials.json copiado"
    else
        echo -e "${YELLOW}⚠️  firebase-credentials.json não encontrado${NC}"
        echo -e "${YELLOW}   Você precisará copiar manualmente para $APP_DIR${NC}"
    fi
    
    echo -e "${GREEN}✅ Arquivos copiados${NC}"
    echo ""
}

# ===== FUNÇÃO: Copiar código da aplicação =====
copy_application_code() {
    echo -e "${BLUE}📦 Copiando código da aplicação...${NC}"
    
    # Criar arquivo .dockerignore se não existir
    if [ ! -f ".dockerignore" ]; then
        cat > .dockerignore << 'DOCKERIGNOREEOF'
node_modules
npm-debug.log
.env
.env.local
.env.*.local
.git
.gitignore
README.md
.DS_Store
coverage
.nyc_output
logs
*.log
.Dockerfile
docker-compose*.yml
.ngrok-url.json
DOCKERIGNOREEOF
    fi
    
    # Criar tarball do código (excluindo node_modules e outros)
    echo "📦 Criando pacote do código..."
    tar --exclude='node_modules' \
        --exclude='.git' \
        --exclude='logs' \
        --exclude='coverage' \
        --exclude='.nyc_output' \
        --exclude='.env*' \
        --exclude='*.log' \
        -czf /tmp/leaf-app-code.tar.gz .
    
    # Copiar para VPS
    echo "📤 Enviando código para VPS..."
    scp /tmp/leaf-app-code.tar.gz $VPS_USER@$VPS_IP:$APP_DIR/
    
    # Extrair na VPS
    ssh $VPS_USER@$VPS_IP << EOF
        cd $APP_DIR
        tar -xzf leaf-app-code.tar.gz
        rm leaf-app-code.tar.gz
        echo "✅ Código extraído"
EOF
    
    # Limpar arquivo temporário
    rm /tmp/leaf-app-code.tar.gz
    
    echo -e "${GREEN}✅ Código copiado${NC}"
    echo ""
}

# ===== FUNÇÃO: Build e iniciar containers =====
build_and_start() {
    echo -e "${BLUE}🔨 Construindo e iniciando containers...${NC}"
    
    ssh $VPS_USER@$VPS_IP << EOF
        cd $APP_DIR
        
        # Parar containers existentes
        echo "🛑 Parando containers existentes..."
        docker compose down -v 2>/dev/null || docker-compose down -v 2>/dev/null || true
        
        # Construir imagens
        echo "🔨 Construindo imagens..."
        echo "   ⏳ Isso pode levar alguns minutos..."
        docker compose build --no-cache 2>&1 | while IFS= read -r line; do echo "   $line"; done || docker-compose build --no-cache 2>&1 | while IFS= read -r line; do echo "   $line"; done
        
        # Iniciar containers
        echo "🚀 Iniciando containers..."
        docker compose up -d 2>&1 || docker-compose up -d 2>&1
        
        # Aguardar inicialização
        echo "⏳ Aguardando inicialização..."
        sleep 15
        
        # Verificar status
        echo "📊 Status dos containers:"
        docker compose ps 2>/dev/null || docker-compose ps 2>/dev/null
        
        echo ""
        echo "📋 Logs recentes:"
        docker compose logs --tail=20 2>/dev/null || docker-compose logs --tail=20 2>/dev/null
EOF
    
    echo -e "${GREEN}✅ Containers iniciados${NC}"
    echo ""
}

# ===== FUNÇÃO: Verificar saúde dos serviços =====
check_health() {
    echo -e "${BLUE}🏥 Verificando saúde dos serviços...${NC}"
    
    ssh $VPS_USER@$VPS_IP << EOF
        cd $APP_DIR
        
        # Verificar Redis
        echo "🔴 Verificando Redis..."
        if docker compose exec -T redis redis-cli -a leaf_redis_2024 ping 2>/dev/null | grep -q PONG || docker-compose exec -T redis redis-cli -a leaf_redis_2024 ping 2>/dev/null | grep -q PONG; then
            echo "✅ Redis está respondendo"
        else
            echo "❌ Redis não está respondendo"
        fi
        
        # Verificar WebSocket Server
        echo "🌐 Verificando WebSocket Server..."
        sleep 5
        if curl -f http://localhost:3001/health > /dev/null 2>&1; then
            echo "✅ WebSocket Server está respondendo"
        else
            echo "❌ WebSocket Server não está respondendo"
            echo "📋 Últimos logs:"
            docker compose logs --tail=30 websocket 2>/dev/null || docker-compose logs --tail=30 websocket 2>/dev/null
        fi
        
        # Verificar Nginx
        echo "🔧 Verificando Nginx..."
        if curl -f http://localhost/health > /dev/null 2>&1; then
            echo "✅ Nginx está respondendo"
        else
            echo "❌ Nginx não está respondendo"
            echo "📋 Últimos logs:"
            docker compose logs --tail=30 nginx 2>/dev/null || docker-compose logs --tail=30 nginx 2>/dev/null
        fi
EOF
    
    echo ""
    echo -e "${GREEN}✅ Verificação concluída${NC}"
    echo ""
}

# ===== FUNÇÃO: Mostrar informações finais =====
show_final_info() {
    echo ""
    echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}✅ DEPLOY CONCLUÍDO COM SUCESSO!${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "${BLUE}📍 URLs:${NC}"
    echo -e "   🌐 API: ${YELLOW}http://$VPS_IP${NC}"
    echo -e "   🔌 WebSocket: ${YELLOW}ws://$VPS_IP${NC}"
    echo -e "   🔗 Health Check: ${YELLOW}http://$VPS_IP/health${NC}"
    echo -e "   💳 Webhook Woovi: ${YELLOW}http://$VPS_IP/api/woovi/webhook${NC}"
    echo ""
    echo -e "${BLUE}📋 Comandos úteis:${NC}"
    echo -e "   Ver logs: ${YELLOW}ssh $VPS_USER@$VPS_IP 'cd $APP_DIR && docker-compose logs -f'${NC}"
    echo -e "   Status: ${YELLOW}ssh $VPS_USER@$VPS_IP 'cd $APP_DIR && docker-compose ps'${NC}"
    echo -e "   Reiniciar: ${YELLOW}ssh $VPS_USER@$VPS_IP 'cd $APP_DIR && docker-compose restart'${NC}"
    echo -e "   Parar: ${YELLOW}ssh $VPS_USER@$VPS_IP 'cd $APP_DIR && docker-compose down'${NC}"
    echo ""
    echo -e "${YELLOW}⚠️  IMPORTANTE:${NC}"
    echo -e "   1. Configure o webhook na Woovi: ${YELLOW}http://$VPS_IP/api/woovi/webhook${NC}"
    echo -e "   2. Verifique as variáveis de ambiente em ${YELLOW}$APP_DIR/.env${NC}"
    echo -e "   3. Configure firewall se necessário (portas 80, 443, 3001)"
    echo ""
}

# ===== EXECUÇÃO PRINCIPAL =====
main() {
    check_prerequisites
    install_docker
    setup_directories
    copy_files
    copy_application_code
    build_and_start
    check_health
    show_final_info
}

# Executar
main

