#!/bin/bash

# 🚀 DEPLOY LEAF APP - CONTABO VPS COM DOCKER
# Script completo de deploy com Docker Compose

set -e

# ===== CONFIGURAÇÕES =====
VPS_IP="${VPS_IP:-${CONTABO_HOST:-}}"
VPS_USER="${VPS_USER:-root}"
VPS_SSH_KEY="${VPS_SSH_KEY:-${SSH_KEY_PATH:-${CONTABO_KEY:-}}}"
APP_DIR="/opt/leaf-app"
PROJECT_DIR="leaf-websocket-backend"
CHECK_RUNTIME_PARITY="${CHECK_RUNTIME_PARITY:-true}"
PUBLIC_API_URL="${PUBLIC_API_URL:-https://api.leaf.app.br}"
PUBLIC_SOCKET_URL="${PUBLIC_SOCKET_URL:-https://socket.leaf.app.br}"
WOOVI_WEBHOOK_PUBLIC_URL="${WOOVI_WEBHOOK_PUBLIC_URL:-$PUBLIC_API_URL/api/woovi/webhook}"
DEPLOY_COPY_LOCAL_ENV="${DEPLOY_COPY_LOCAL_ENV:-false}"
REQUIRED_ENV_KEYS=("REDIS_PASSWORD" "CORS_ORIGIN" "JWT_SECRET")

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🚀 DEPLOY LEAF APP - CONTABO VPS${NC}"
echo "=========================================="
echo -e "📍 Host: ${YELLOW}${VPS_IP:-"não configurado"}${NC}"
echo -e "🔑 Key: ${YELLOW}${VPS_SSH_KEY:-"None"}${NC}"
echo -e "📁 Diretório: ${YELLOW}$APP_DIR${NC}"
echo -e "📝 Copiar .env local: ${YELLOW}$DEPLOY_COPY_LOCAL_ENV${NC}"
echo ""

validate_local_env_file() {
    local env_file="$1"
    local missing=()

    if [ ! -f "$env_file" ]; then
        echo -e "${RED}❌ Arquivo de env local não encontrado: $env_file${NC}"
        return 1
    fi

    for key in "${REQUIRED_ENV_KEYS[@]}"; do
        local value
        value="$(grep -E "^${key}=" "$env_file" 2>/dev/null | head -n1 | cut -d '=' -f2- || true)"
        if [ -z "$value" ] || [[ "$value" =~ ^(CHANGE_ME|TODO|TEMPLATE|example|placeholder)$ ]]; then
            missing+=("$key")
        fi
    done

    if [ "${#missing[@]}" -gt 0 ]; then
        echo -e "${RED}❌ Env local inválido em $env_file. Variáveis ausentes/vazias: ${missing[*]}${NC}"
        return 1
    fi

    return 0
}

validate_remote_env_file() {
    echo -e "${BLUE}🧪 Validando .env remoto antes de tocar containers...${NC}"
    local required_keys="${REQUIRED_ENV_KEYS[*]}"

    ssh -i "$VPS_SSH_KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$VPS_USER@$VPS_IP" << EOF
        set -e
        cd $APP_DIR
        if [ ! -s .env ]; then
            echo "❌ /opt/leaf-app/.env ausente ou vazio"
            exit 1
        fi
        missing=""
        for key in $required_keys; do
            value="\$(grep -E "^\${key}=" .env 2>/dev/null | head -n1 | cut -d '=' -f2- || true)"
            if [ -z "\$value" ]; then
                missing="\$missing \$key"
            fi
        done
        if [ -n "\$missing" ]; then
            echo "❌ Variáveis obrigatórias ausentes/vazias no .env remoto:\$missing"
            exit 1
        fi
        echo "✅ .env remoto válido para: $required_keys"
EOF
}

backup_remote_env_if_exists() {
    echo -e "${BLUE}🧷 Criando backup remoto do .env, se existir...${NC}"
    ssh -i "$VPS_SSH_KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$VPS_USER@$VPS_IP" << EOF
        set -e
        mkdir -p $APP_DIR/env-backups
        if [ -s $APP_DIR/.env ]; then
            backup_path="$APP_DIR/env-backups/.env.\$(date +%Y%m%d-%H%M%S).bak"
            cp $APP_DIR/.env "\$backup_path"
            chmod 600 "\$backup_path" || true
            echo "✅ Backup criado em \$backup_path"
        else
            echo "ℹ️  Nenhum .env remoto existente para backup"
        fi
EOF
}

remote_env_exists() {
    ssh -i "$VPS_SSH_KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$VPS_USER@$VPS_IP" "[ -s '$APP_DIR/.env' ]"
}

# ===== FUNÇÃO: Verificar pré-requisitos =====
check_prerequisites() {
    echo -e "${BLUE}🔍 Verificando pré-requisitos...${NC}"

    if [ -z "$VPS_IP" ]; then
        echo -e "${RED}❌ Configure VPS_IP ou CONTABO_HOST para o host Contabo${NC}"
        exit 1
    fi

    if [ -z "$VPS_SSH_KEY" ] || [ ! -f "$VPS_SSH_KEY" ]; then
        echo -e "${RED}❌ Configure VPS_SSH_KEY, SSH_KEY_PATH ou CONTABO_KEY com uma chave SSH válida${NC}"
        exit 1
    fi
    
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

runtime_parity_precheck() {
    if [[ "$CHECK_RUNTIME_PARITY" != "true" ]]; then
        return
    fi

    if [[ -x "./scripts/ops/check-vps-runtime-parity.sh" ]]; then
        echo -e "${BLUE}🧭 Verificando paridade de runtime (pré-deploy, informativo)...${NC}"
        VPS_HOST="$VPS_IP" VPS_KEY="$VPS_SSH_KEY" RUNTIME_MODE=modular STRICT=false FETCH_REMOTE=true ./scripts/ops/check-vps-runtime-parity.sh || true
        echo ""
    fi
}

# ===== FUNÇÃO: Instalar Docker na VPS =====
install_docker() {
    echo -e "${BLUE}🐳 Instalando Docker na VPS...${NC}"
    
    ssh -i "$VPS_SSH_KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$VPS_USER@$VPS_IP" << 'EOF'
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
    
    ssh -i "$VPS_SSH_KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$VPS_USER@$VPS_IP" << EOF
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
    
    # Copiar arquivos essenciais
    echo "📤 Copiando arquivos..."
    scp -i "$VPS_SSH_KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null docker-compose.hostinger.yml "$VPS_USER@$VPS_IP:$APP_DIR/docker-compose.yml"
    scp -i "$VPS_SSH_KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null Dockerfile "$VPS_USER@$VPS_IP:$APP_DIR/"
    scp -i "$VPS_SSH_KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null package.json "$VPS_USER@$VPS_IP:$APP_DIR/"
    scp -i "$VPS_SSH_KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null package-lock.json "$VPS_USER@$VPS_IP:$APP_DIR/" 2>/dev/null || echo "⚠️  package-lock.json não encontrado, continuando..."
    scp -i "$VPS_SSH_KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null nginx.conf "$VPS_USER@$VPS_IP:$APP_DIR/"
    
    # Preservar .env remoto por padrão. Sobrescrita local exige flag explícita.
    if [ "$DEPLOY_COPY_LOCAL_ENV" = "true" ]; then
        validate_local_env_file ".env.production"
        backup_remote_env_if_exists
        echo -e "${BLUE}📝 Copiando .env.production validado para a VPS...${NC}"
        scp -i "$VPS_SSH_KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null .env.production "$VPS_USER@$VPS_IP:$APP_DIR/.env"
        echo "✅ .env remoto atualizado a partir de .env.production"
    elif remote_env_exists; then
        echo -e "${GREEN}✅ Preservando .env remoto existente${NC}"
    else
        echo -e "${YELLOW}⚠️  .env remoto não existe. Tentando bootstrap com .env.production validado...${NC}"
        validate_local_env_file ".env.production"
        scp -i "$VPS_SSH_KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null .env.production "$VPS_USER@$VPS_IP:$APP_DIR/.env"
        echo "✅ .env remoto criado a partir de .env.production"
    fi

    validate_remote_env_file
    
    # Copiar firebase-credentials.json se existir
    if [ -f "firebase-credentials.json" ]; then
        echo -e "${BLUE}🔥 Copiando firebase-credentials.json...${NC}"
        scp -i "$VPS_SSH_KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null firebase-credentials.json "$VPS_USER@$VPS_IP:$APP_DIR/"
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
    echo -e "${BLUE}⬆️  Enviando código fonte para a VPS...${NC}"
    scp -i "$VPS_SSH_KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null /tmp/leaf-app-code.tar.gz "$VPS_USER@$VPS_IP:$APP_DIR/"
    
    # Extrair na VPS
    ssh -i "$VPS_SSH_KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$VPS_USER@$VPS_IP" << EOF
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
    validate_remote_env_file
    
    ssh -i "$VPS_SSH_KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$VPS_USER@$VPS_IP" << EOF
        cd $APP_DIR

        # Construir imagens
        echo "🔨 Construindo imagens..."
        echo "   ⏳ Isso pode levar alguns minutos..."
        docker compose build --no-cache 2>&1 | while IFS= read -r line; do echo "   $line"; done || docker-compose build --no-cache 2>&1 | while IFS= read -r line; do echo "   $line"; done
        
        # Iniciar containers
        echo "🚀 Iniciando containers sem apagar volumes..."
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
    
    ssh -i "$VPS_SSH_KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$VPS_USER@$VPS_IP" << EOF
        cd $APP_DIR
        
        # Verificar Redis
        echo "🔴 Verificando Redis..."
        REDIS_PASSWORD_VALUE="$(grep -E '^REDIS_PASSWORD=' .env 2>/dev/null | head -n1 | cut -d '=' -f2-)"
        if [ -z "$REDIS_PASSWORD_VALUE" ]; then
            echo "❌ REDIS_PASSWORD não encontrado no .env"
        elif docker compose exec -T redis env REDISCLI_AUTH="$REDIS_PASSWORD_VALUE" redis-cli ping 2>/dev/null | grep -q PONG || docker-compose exec -T redis env REDISCLI_AUTH="$REDIS_PASSWORD_VALUE" redis-cli ping 2>/dev/null | grep -q PONG; then
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

runtime_parity_postcheck() {
    if [[ "$CHECK_RUNTIME_PARITY" != "true" ]]; then
        return
    fi

    if [[ -x "./scripts/ops/check-vps-runtime-parity.sh" ]]; then
        echo -e "${BLUE}🧭 Verificando paridade de runtime (pós-deploy, obrigatório)...${NC}"
        VPS_HOST="$VPS_IP" VPS_KEY="$VPS_SSH_KEY" RUNTIME_MODE=modular STRICT=true FETCH_REMOTE=false ./scripts/ops/check-vps-runtime-parity.sh
        echo -e "${GREEN}✅ Runtime em paridade após deploy${NC}"
        echo ""
    fi
}

# ===== FUNÇÃO: Mostrar informações finais =====
show_final_info() {
    echo ""
    echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}✅ DEPLOY CONCLUÍDO COM SUCESSO!${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "${BLUE}📍 URLs:${NC}"
    echo -e "   🌐 API: ${YELLOW}$PUBLIC_API_URL${NC}"
    echo -e "   🔌 WebSocket: ${YELLOW}$PUBLIC_SOCKET_URL${NC}"
    echo -e "   🔗 Health Check: ${YELLOW}$PUBLIC_API_URL/health${NC}"
    echo -e "   💳 Webhook Woovi: ${YELLOW}$WOOVI_WEBHOOK_PUBLIC_URL${NC}"
    echo ""
    echo -e "${BLUE}📋 Comandos úteis:${NC}"
    echo -e "   Ver logs: ${YELLOW}ssh $VPS_USER@$VPS_IP 'cd $APP_DIR && docker-compose logs -f'${NC}"
    echo -e "   Status: ${YELLOW}ssh $VPS_USER@$VPS_IP 'cd $APP_DIR && docker-compose ps'${NC}"
    echo -e "   Reiniciar: ${YELLOW}ssh $VPS_USER@$VPS_IP 'cd $APP_DIR && docker-compose restart'${NC}"
    echo -e "   Parar: ${YELLOW}ssh $VPS_USER@$VPS_IP 'cd $APP_DIR && docker-compose down'${NC}"
    echo ""
    echo -e "${YELLOW}⚠️  IMPORTANTE:${NC}"
    echo -e "   1. Configure o webhook na Woovi: ${YELLOW}$WOOVI_WEBHOOK_PUBLIC_URL${NC}"
    echo -e "   2. Verifique as variáveis de ambiente em ${YELLOW}$APP_DIR/.env${NC}"
    echo -e "   3. Configure firewall se necessário (portas 80, 443, 3001)"
    echo ""
}

# ===== EXECUÇÃO PRINCIPAL =====
main() {
    check_prerequisites
    runtime_parity_precheck
    install_docker
    setup_directories
    copy_files
    copy_application_code
    build_and_start
    check_health
    runtime_parity_postcheck
    show_final_info
}

# Executar
main
